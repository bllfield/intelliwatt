// @ts-ignore - OpenAI SDK is provided as a runtime dependency; types resolve in real installs.
import OpenAI from "openai";

/**
 * Dedicated OpenAI client for the EFL Fact Card / PlanRules extractor.
 *
 * Env (in order of precedence):
 *   OPENAI_FACT_CARD_API_KEY              = API key for Fact Card Project
 *   OPENAI_API_KEY                        = fallback API key (shared)
 *   OPENAI_IntelliWatt_Fact_Card_Parser   = feature flag (truthy enables)
 *
 * This file is server-only. Do not import it from client components.
 * IMPORTANT: Do not create the client at import-time so missing env does NOT
 * crash module loading. Always go through getOpenAiClient()/factCardAiEnabled.
 */

let cachedClient: OpenAI | null | undefined;
let hasWarned = false;

function isTruthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on" || s === "enabled";
}

export function factCardAiEnabled(): boolean {
  return isTruthy(process.env.OPENAI_IntelliWatt_Fact_Card_Parser);
}

function getFactCardApiKey(): string | null {
  const key =
    process.env.OPENAI_FACT_CARD_API_KEY ||
    process.env.OPENAI_API_KEY ||
    "";
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getOpenAiClient(): OpenAI | null {
  if (typeof cachedClient !== "undefined") {
    return cachedClient;
  }

  const apiKey = getFactCardApiKey();
  if (!apiKey) {
    if (!hasWarned) {
      // eslint-disable-next-line no-console
      console.warn(
        "[openai-fact-card-parser] No API key configured; set OPENAI_FACT_CARD_API_KEY or OPENAI_API_KEY.",
      );
      hasWarned = true;
    }
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}
