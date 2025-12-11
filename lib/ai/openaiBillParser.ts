// @ts-ignore - OpenAI SDK is provided as a runtime dependency; types resolve in real installs.
import OpenAI from 'openai';

/**
 * Dedicated OpenAI client for the bill parser (current-plan module).
 *
 * Uses its own API key env var so bill parsing can be isolated from any
 * other OpenAI usage in the app.
 *
 * Env:
 *   OPENAI_IntelliWatt_Bill_Parcer = API key for bill parsing only
 *
 * This file is server-only. Do not import it from client components.
 */
const apiKey = process.env.OPENAI_IntelliWatt_Bill_Parcer;

if (!apiKey) {
  // eslint-disable-next-line no-console
  console.warn(
    '[openai-bill-parser] OPENAI_IntelliWatt_Bill_Parcer is not set; bill parsing will fall back to regex-only behavior.',
  );
}

export const openaiBillParser = new OpenAI({
  apiKey: apiKey!,
});


