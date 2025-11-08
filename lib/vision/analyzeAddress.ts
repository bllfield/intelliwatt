import { ImageAnnotatorClient } from '@google-cloud/vision';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

const client = new ImageAnnotatorClient();

export function runVisionAddressAnalysis(imageBuffer: Buffer) {
  return client.textDetection(imageBuffer);
}
