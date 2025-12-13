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

export function billParserAiEnabled(): boolean {
  return isTruthy(process.env.OPENAI_IntelliWatt_Bill_Parcer);
}

function getBillParserApiKey(): string | null {
  const key =
    process.env.OPENAI_BILL_PARSER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "";
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
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
