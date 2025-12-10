// @ts-ignore - OpenAI SDK is provided as a runtime dependency; types resolve in real installs.
import OpenAI from 'openai';

/**
 * Shared OpenAI client for server-side usage (API routes, bill parsing, etc.).
 *
 * This file is server-only. Do not import it from client components.
 */
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});


