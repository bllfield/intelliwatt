// @ts-ignore - OpenAI SDK is provided as a runtime dependency; types resolve in real installs.
import OpenAI from "openai";

/**
 * Dedicated OpenAI client for the EFL Fact Card / PlanRules extractor.
 *
 * Env:
 *   OPENAI_API_KEY                        = API key for OpenAI
 *   OPENAI_IntelliWatt_Fact_Card_Parser  = "1" to enable Fact Card AI (flag)
 *
 * This file is server-only. Do not import it from client components.
 * IMPORTANT: Do not create the client at import-time so missing env does NOT
 * crash module loading. Always go through getOpenAiClient().
 */

let cachedClient: OpenAI | null | undefined;
let hasWarned = false;

export function getOpenAiClient(): OpenAI | null {
  if (typeof cachedClient !== "undefined") {
    return cachedClient;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    if (!hasWarned) {
      // eslint-disable-next-line no-console
      console.warn(
        "[openai-fact-card-parser] OPENAI_API_KEY is not set; EFL Fact Card AI extraction will not be available.",
      );
      hasWarned = true;
    }
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}
