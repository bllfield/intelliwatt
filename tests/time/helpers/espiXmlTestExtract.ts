/**
 * Test-only: pull raw ESPI rows from large XML fixtures. Not part of production ingest.
 */

export type EspiXmlTestReading = {
  startSeconds: number;
  durationSeconds: number;
  value: string;
};

export function extractEspiReadingsFromXmlForTest(xml: string): {
  readings: EspiXmlTestReading[];
  tzOffsetSeconds: number | null;
  titleHints: string[];
} {
  const tzMatch = xml.match(/<tzOffset>(-?\d+)<\/tzOffset>/);
  const tzOffsetSeconds = tzMatch ? Number(tzMatch[1]) : null;

  const titleHints = Array.from(xml.matchAll(/<title>([^<]+)<\/title>/gi))
    .map((m) => m[1]?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 20);

  const readings: EspiXmlTestReading[] = [];
  const blockRe =
    /<IntervalReading>[\s\S]*?<timePeriod>[\s\S]*?<duration>(\d+)<\/duration>[\s\S]*?<start>(\d+)<\/start>[\s\S]*?<\/timePeriod>[\s\S]*?<value>([^<]+)<\/value>[\s\S]*?<\/IntervalReading>/gi;

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(xml)) !== null) {
    const durationSeconds = Number(match[1]);
    const startSeconds = Number(match[2]);
    const value = match[3]?.trim() ?? "";
    if (!Number.isFinite(startSeconds) || !value) continue;
    readings.push({
      startSeconds,
      durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 900,
      value,
    });
  }

  return { readings, tzOffsetSeconds, titleHints };
}
