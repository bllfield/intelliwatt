// @ts-ignore - OpenAI SDK is provided as a runtime dependency; types resolve in real installs.
import OpenAI from 'openai';

/**
 * Dedicated OpenAI client for the EFL Fact Card / PlanRules extractor.
 *
 * Uses its own API key env var so fact-card parsing can be isolated from any
 * other OpenAI usage in the app.
 *
 * Env:
 *   OPENAI_IntelliWatt_Fact_Card_Parser = API key for fact card parsing only
 *
 * This file is server-only. Do not import it from client components.
 */
const apiKey = process.env.OPENAI_IntelliWatt_Fact_Card_Parser;

if (!apiKey) {
  // eslint-disable-next-line no-console
  console.warn(
    '[openai-fact-card-parser] OPENAI_IntelliWatt_Fact_Card_Parser is not set; EFL Fact Card AI extraction will not be available.',
  );
}

export const openaiFactCardParser = new OpenAI({
  apiKey: apiKey!,
});


