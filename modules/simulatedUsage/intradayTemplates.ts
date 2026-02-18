const INTERVALS_PER_DAY = 96;

export const INTRADAY_TEMPLATE_VERSION = "v1";

export type Shape96 = number[]; // length 96, sums to 1

function normalize(vec: number[]): Shape96 {
  const v = vec.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = v.reduce((a, b) => a + b, 0);
  if (sum <= 0) return Array.from({ length: INTERVALS_PER_DAY }, () => 1 / INTERVALS_PER_DAY);
  return v.map((x) => x / sum);
}

function gaussian(x: number, mu: number, sigma: number): number {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z);
}

export function getGenericWeekdayShape96(): Shape96 {
  const bins = Array.from({ length: INTERVALS_PER_DAY }, (_, i) => {
    const hour = i / 4;
    const morning = 0.9 * gaussian(hour, 7.5, 1.8);
    const midday = 0.6 * gaussian(hour, 13.0, 2.8);
    const evening = 1.3 * gaussian(hour, 19.5, 2.3);
    const overnight = 0.2;
    return overnight + morning + midday + evening;
  });
  return normalize(bins);
}

export function getGenericWeekendShape96(): Shape96 {
  const bins = Array.from({ length: INTERVALS_PER_DAY }, (_, i) => {
    const hour = i / 4;
    const lateMorning = 1.0 * gaussian(hour, 10.5, 2.2);
    const afternoon = 0.9 * gaussian(hour, 15.0, 2.7);
    const evening = 1.1 * gaussian(hour, 20.0, 2.5);
    const overnight = 0.25;
    return overnight + lateMorning + afternoon + evening;
  });
  return normalize(bins);
}

export function normalizeShape96(vec: number[]): Shape96 {
  if (!Array.isArray(vec) || vec.length !== INTERVALS_PER_DAY) {
    return getGenericWeekdayShape96();
  }
  return normalize(vec);
}

