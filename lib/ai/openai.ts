// @ts-ignore - OpenAI SDK is provided as a runtime dependency; types resolve in real installs.
import OpenAI from "openai";

/**
 * Shared OpenAI client for server-side usage (generic tools).
 *
 * Env:
 *   OPENAI_API_KEY = default/shared API key
 *
 * This file is server-only. Do not import it from client components.
 * IMPORTANT: prefer per-module clients (`openaiFactCardParser`, `openaiBillParser`)
 * for Fact Card / Bill parsing; this is for general/shared use only.
 */

let sharedClient: OpenAI | null | undefined;
let sharedWarned = false;

export function getSharedOpenAiClient(): OpenAI | null {
  if (typeof sharedClient !== "undefined") {
    return sharedClient;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    if (!sharedWarned) {
      // eslint-disable-next-line no-console
      console.warn(
        "[openai-shared] OPENAI_API_KEY is not set; shared OpenAI client will not be available.",
      );
      sharedWarned = true;
    }
    sharedClient = null;
    return sharedClient;
  }

  sharedClient = new OpenAI({ apiKey });
  return sharedClient;
}
