// @ts-ignore - OpenAI SDK is provided as a runtime dependency; types resolve in real installs.
import OpenAI from "openai";

/**
 * Dedicated OpenAI client for the bill parser (current-plan module).
 *
 * Env (in order of precedence):
 *   OPENAI_BILL_PARSER_API_KEY           = API key for Bill Parser Project
 *   OPENAI_API_KEY                        = fallback API key (shared)
 *   OPENAI_IntelliWatt_Bill_Parcer        = feature flag (truthy enables)
 *
 * This file is server-only. Do not import it from client components.
 * IMPORTANT: Do not create the client at import-time so missing env does NOT
 * crash module loading. Always go through billParserAiEnabled/getOpenAiBillClient.
 */

let billClient: OpenAI | null | undefined;
let billWarned = false;

function isTruthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on" || s === "enabled";
}

function looksLikeKey(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim();
  return s.startsWith("sk-") && s.length > 20;
}

export function billParserAiEnabled(): boolean {
  const flag = process.env.OPENAI_IntelliWatt_Bill_Parcer;
  // Legacy configs may still store the API key directly in this var; treat a
  // key-shaped value as "enabled" as well as explicit truthy flags.
  return isTruthy(flag) || looksLikeKey(flag);
}

function getBillParserApiKey(): string | null {
  const k1 = process.env.OPENAI_BILL_PARSER_API_KEY;
  if (looksLikeKey(k1)) return k1!.trim();

  // Legacy: some deployments stored the key directly in OPENAI_IntelliWatt_Bill_Parcer.
  const legacy = process.env.OPENAI_IntelliWatt_Bill_Parcer;
  if (looksLikeKey(legacy)) return legacy!.trim();

  const generic = process.env.OPENAI_API_KEY;
  if (looksLikeKey(generic)) return generic!.trim();

  return null;
}

export function getOpenAiBillClient(): OpenAI | null {
  if (typeof billClient !== "undefined") {
    return billClient;
  }

  const apiKey = getBillParserApiKey();
  if (!apiKey) {
    if (!billWarned) {
      // eslint-disable-next-line no-console
      console.warn(
        "[openai-bill-parser] No API key configured; set OPENAI_BILL_PARSER_API_KEY or OPENAI_API_KEY.",
      );
      billWarned = true;
    }
    billClient = null;
    return billClient;
  }

  billClient = new OpenAI({ apiKey });
  return billClient;
}
