// lib/ercot/ews.ts

/**
 * ERCOT EWS client (mutual TLS)
 * - Calls GetReports for a ReportTypeId (203 = TDSP ESIID Extract)
 * - Downloads returned URLs (assumes they are direct HTTPS links)
 * - Returns list of { filename, url, buffer }
 *
 * Environment variables:
 * - ERCOT_EWS_BASE       e.g. https://ews.ercot.com (the EWS service base)
 * - ERCOT_EWS_REPORTTYPE default 203
 * - ERCOT_EWS_PFX        (optional) base64 of a PFX file (preferred)
 * - ERCOT_EWS_PFX_PASS   (optional) password for PFX
 * - ERCOT_EWS_CERT       (optional) PEM certificate text
 * - ERCOT_EWS_KEY        (optional) PEM private key text
 * - ERCOT_EWS_CA         (optional) PEM chain to trust (if needed)
 *
 * Notes:
 * - If PFX is provided, it will be used to create the TLS client.
 * - If PEM cert/key are provided, they will be used.
 */

import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import http from "http";
import crypto from "crypto";

type ReportArtifact = {
  fileName: string;
  downloadUrl: string;
  postDateTime?: string;
};

function writeTmp(name: string, contents: string) {
  const p = path.join(os.tmpdir(), `intelliwatt-ercot-${name}-${crypto.randomBytes(6).toString("hex")}`);
  fs.writeFileSync(p, contents, { mode: 0o600 });
  return p;
}

export function buildAgent() {
  const pfxBase64 = process.env.ERCOT_EWS_PFX;
  if (pfxBase64) {
    const pfxBuf = Buffer.from(pfxBase64, "base64");
    return new https.Agent({
      pfx: pfxBuf,
      passphrase: process.env.ERCOT_EWS_PFX_PASS || undefined,
      rejectUnauthorized: process.env.NODE_ENV === "production",
      ca: process.env.ERCOT_EWS_CA ? Buffer.from(process.env.ERCOT_EWS_CA) : undefined,
    });
  }

  const certPem = process.env.ERCOT_EWS_CERT;
  const keyPem = process.env.ERCOT_EWS_KEY;
  if (certPem && keyPem) {
    const certPath = writeTmp("cert.pem", certPem);
    const keyPath = writeTmp("key.pem", keyPem);
    const ca = process.env.ERCOT_EWS_CA ? writeTmp("ca.pem", process.env.ERCOT_EWS_CA) : undefined;
    const agent = new https.Agent({
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
      ca: ca ? fs.readFileSync(ca) : undefined,
      rejectUnauthorized: process.env.NODE_ENV === "production",
    });
    return agent;
  }

  throw new Error("No EWS client credentials configured (ERCOT_EWS_PFX or ERCOT_EWS_CERT+ERCOT_EWS_KEY required)");
}

async function postXml(url: string, xml: string, agent: https.Agent) {
  return new Promise<string>((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(xml),
      },
      agent,
    };

    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`EWS POST ${res.statusCode} ${res.statusMessage} - ${data.slice(0, 500)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(xml);
    req.end();
  });
}

// Helpers to parse simple XML minimalistically (no heavy parser)
function extractArtifactsFromSoap(xmlText: string): ReportArtifact[] {
  // crude but practical: find <Artifact>..</Artifact> blocks and inside search for fileName and downloadUrl
  const artifacts: ReportArtifact[] = [];
  const artifactBlocks = Array.from(xmlText.matchAll(/<Artifact[^>]*>([\s\S]*?)<\/Artifact>/gi)).map(m => m[1]);
  for (const block of artifactBlocks) {
    const fileNameMatch = block.match(/<FileName>([^<]+)<\/FileName>/i);
    const urlMatch = block.match(/<Url>([^<]+)<\/Url>/i) || block.match(/<DownloadUrl>([^<]+)<\/DownloadUrl>/i) || block.match(/<Href>([^<]+)<\/Href>/i);
    const postDate = (block.match(/<PostDateTime>([^<]+)<\/PostDateTime>/i) || [])[1];
    if (fileNameMatch && urlMatch) {
      artifacts.push({
        fileName: fileNameMatch[1].trim(),
        downloadUrl: urlMatch[1].trim(),
        postDateTime: postDate,
      });
    }
  }
  return artifacts;
}

export async function getEwsReportsForReportType(reportType = parseInt(process.env.ERCOT_EWS_REPORTTYPE || "203", 10)) {
  const base = process.env.ERCOT_EWS_BASE;
  if (!base) throw new Error("ERCOT_EWS_BASE not configured");

  const agent = buildAgent();

  // Build a minimal SOAP GetReports body for ReportTypeId
  // NOTE: ERCOT's exact SOAP envelope may differ; adjust if ERCOT supplies a sample.
  const today = new Date().toISOString().slice(0, 10);
  const from = today;
  const to = today;

  const getReportsXml = `<?xml version="1.0" encoding="utf-8"?>
  <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ews="http://www.ercot.com/ews">
    <soapenv:Header/>
    <soapenv:Body>
      <ews:GetReportsRequest>
        <ews:ReportTypeId>${reportType}</ews:ReportTypeId>
        <ews:FromDate>${from}</ews:FromDate>
        <ews:ToDate>${to}</ews:ToDate>
      </ews:GetReportsRequest>
    </soapenv:Body>
  </soapenv:Envelope>`;

  const endpoint = base.replace(/\/$/, "") + "/EWS"; // typical path; confirm with ERCOT documentation
  const xmlResp = await postXml(endpoint, getReportsXml, agent);

  // Parse artifacts
  const artifacts = extractArtifactsFromSoap(xmlResp);
  if (!artifacts.length) {
    // As a fallback, try to locate direct URL patterns in the response
    const zipMatches = Array.from(xmlResp.matchAll(/https?:\/\/[^\s'"]+\.zip/gi)).map(m => m[0]);
    const uniq = Array.from(new Set(zipMatches));
    return uniq.map((u, i) => ({ fileName: path.basename(u), downloadUrl: u, postDateTime: undefined }));
  }

  return artifacts;
}

export async function downloadUrlToBuffer(url: string, agent: https.Agent) {
  return new Promise<Buffer>((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      agent,
    };

    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        reject(new Error(`Download ${url} failed ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.end();
  });
}

