import express, { type NextFunction, type Request, type Response } from "express";
import dns from "node:dns/promises";
import net from "node:net";

type ProxyRequestBody = {
  url?: unknown;
  timeoutMs?: unknown;
};

function envStr(key: string, fallback = ""): string {
  const v = process.env[key];
  return typeof v === "string" ? v.trim() : fallback;
}

function envNum(key: string, fallback: number): number {
  const raw = envStr(key, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const HOST = envStr("HOST", "127.0.0.1");
const PORT = envNum("PORT", 8088);
const TOKEN = envStr("EFL_FETCH_PROXY_TOKEN", "");
const MAX_BYTES = Math.max(1024 * 1024, envNum("EFL_FETCH_PROXY_MAX_BYTES", 15 * 1024 * 1024));
const ALLOW_HOSTS = envStr("EFL_FETCH_PROXY_ALLOW_HOSTS", "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function logEvent(event: string, details?: Record<string, unknown>) {
  const payload = details ? ` ${JSON.stringify(details)}` : "";
  // eslint-disable-next-line no-console
  console.log(`[efl-fetch-proxy] ${event}${payload}`);
}

function isPrivateIp(ip: string): boolean {
  // IPv4 ranges
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("127.")) return true;
  if (ip.startsWith("192.168.")) return true;
  // 172.16.0.0/12
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  // Link-local
  if (ip.startsWith("169.254.")) return true;

  // IPv6 ranges (loopback, link-local, unique local)
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (fc00::/7)

  return false;
}

async function assertSafeUrl(target: URL) {
  if (target.protocol !== "https:") {
    throw new Error("Only https:// URLs are allowed.");
  }

  // Avoid non-standard ports entirely.
  const port = target.port ? Number(target.port) : 443;
  if (!Number.isFinite(port) || port !== 443) {
    throw new Error("Only default HTTPS port 443 is allowed.");
  }

  const host = target.hostname.toLowerCase();
  if (!host) throw new Error("Missing hostname.");
  if (host === "localhost" || host.endsWith(".local")) {
    throw new Error("Localhost is not allowed.");
  }

  if (ALLOW_HOSTS.length) {
    const ok = ALLOW_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
    if (!ok) {
      throw new Error(`Host not allowed (allowlist enabled): ${host}`);
    }
  }

  const ipKind = net.isIP(host);
  if (ipKind) {
    if (isPrivateIp(host)) throw new Error("Private IP targets are not allowed.");
    return;
  }

  // Resolve hostname to prevent DNS rebinding to private IPs.
  const addrs = await dns.lookup(host, { all: true, verbatim: true });
  if (!addrs?.length) throw new Error("DNS lookup returned no addresses.");
  for (const a of addrs) {
    if (a?.address && isPrivateIp(a.address)) {
      throw new Error("DNS resolved to a private IP; blocked.");
    }
  }
}

async function readResponseBytesWithLimit(res: Response, limitBytes: number): Promise<Buffer> {
  const body = res.body;
  if (!body) return Buffer.alloc(0);

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value && value.byteLength) {
      total += value.byteLength;
      if (total > limitBytes) {
        throw new Error(`Response exceeded maxBytes=${limitBytes}`);
      }
      chunks.push(Buffer.from(value));
    }
  }

  return Buffer.concat(chunks);
}

function requireBearerAuth(req: Request, res: Response, next: NextFunction) {
  if (!TOKEN) return next();
  const header = String(req.headers.authorization ?? "").trim();
  const expected = `Bearer ${TOKEN}`;
  if (header === expected) return next();
  res.status(401).json({ ok: false, error: "unauthorized" });
}

function jsonError(res: Response, status: number, error: string, details?: any) {
  return res.status(status).json({ ok: false, error, ...(details ? { details } : {}) });
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

app.get("/health", (_req, res) => res.type("text/plain").send("ok"));

app.post("/efl/fetch", requireBearerAuth, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as ProxyRequestBody;
  const rawUrl = String(body.url ?? "").trim();
  const timeoutMsRaw = Number(body.timeoutMs ?? 20_000);
  const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(1_000, Math.min(45_000, timeoutMsRaw)) : 20_000;

  if (!rawUrl) return jsonError(res, 400, "Missing url");

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return jsonError(res, 400, "Invalid url");
  }

  try {
    await assertSafeUrl(target);
  } catch (e) {
    return jsonError(res, 400, "Blocked URL", { message: e instanceof Error ? e.message : String(e) });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

  const startedAt = Date.now();
  try {
    const upstream = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent": ua,
        accept: "application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const finalUrl = upstream.url || target.toString();
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";

    // Mirror upstream status on failures (helps the caller decide what to do).
    if (!upstream.ok) {
      const durMs = Date.now() - startedAt;
      logEvent("upstream_fail", {
        status: upstream.status,
        host: target.hostname,
        ms: durMs,
      });
      return res.status(upstream.status).json({
        ok: false,
        error: `Upstream HTTP ${upstream.status} ${upstream.statusText}`.trim(),
        details: {
          finalUrl,
          contentType,
          ms: durMs,
        },
      });
    }

    const buf = await readResponseBytesWithLimit(upstream, MAX_BYTES);
    const durMs = Date.now() - startedAt;

    logEvent("ok", {
      host: target.hostname,
      bytes: buf.byteLength,
      ms: durMs,
    });

    res.setHeader("content-type", contentType);
    res.setHeader("x-final-url", finalUrl);
    res.setHeader("x-proxy-notes", `bytes=${buf.byteLength};ms=${durMs};maxBytes=${MAX_BYTES}`);
    return res.status(200).send(buf);
  } catch (e) {
    const durMs = Date.now() - startedAt;
    logEvent("error", { host: target.hostname, ms: durMs, message: e instanceof Error ? e.message : String(e) });
    return jsonError(res, 502, "Fetch failed", { message: e instanceof Error ? e.message : String(e), ms: durMs });
  } finally {
    clearTimeout(timeout);
  }
});

// Last-resort error handler: keep JSON.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error("[efl-fetch-proxy] unhandled", err);
  return jsonError(res, 500, "Internal error");
});

app.listen(PORT, HOST, () => {
  logEvent("listening", {
    host: HOST,
    port: PORT,
    maxBytes: MAX_BYTES,
    allowHosts: ALLOW_HOSTS.length ? ALLOW_HOSTS : null,
    auth: TOKEN ? "required" : "disabled",
  });
});

