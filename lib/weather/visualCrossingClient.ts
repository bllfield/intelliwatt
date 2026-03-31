const TIMELINE_BASE =
  "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline";

export type VisualCrossingHourlyRow = {
  timestampUtc: Date;
  temperatureC: number | null;
  cloudcoverPct: number | null;
  solarRadiation: number | null;
};

export type VisualCrossingDailyTemperatureRow = {
  dateKey: string;
  temperatureMeanC: number | null;
  temperatureMinC: number | null;
  temperatureMaxC: number | null;
};

type TimelineHour = {
  datetimeEpoch?: number | null;
  temp?: number | null;
  cloudcover?: number | null;
  solarradiation?: number | null;
};

type TimelineDay = {
  datetime?: string;
  temp?: number | null;
  tempmin?: number | null;
  tempmax?: number | null;
  hours?: TimelineHour[];
};

type TimelineResponse = {
  days?: TimelineDay[];
  errorCode?: number;
  message?: string;
};

function apiKey(): string {
  const key = String(process.env.VISUAL_CROSSING_API_KEY ?? "").trim();
  if (!key) {
    throw new Error("VISUAL_CROSSING_API_KEY is not configured.");
  }
  return key;
}

function toNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchTimelineJson(args: {
  lat: number;
  lon: number;
  startDate: string;
  endDate: string;
  include: "hours" | "days";
  elements: string;
}): Promise<TimelineResponse> {
  const location = `${args.lat},${args.lon}`;
  const path = `${location}/${args.startDate.slice(0, 10)}/${args.endDate.slice(0, 10)}`;
  const params = new URLSearchParams({
    key: apiKey(),
    unitGroup: "metric",
    include: args.include,
    elements: args.elements,
    contentType: "json",
  });
  const url = `${TIMELINE_BASE}/${path}?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Visual Crossing fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Visual Crossing API error ${res.status}: ${text.slice(0, 200)}`);
  }

  let data: TimelineResponse;
  try {
    data = (await res.json()) as TimelineResponse;
  } catch {
    throw new Error("Visual Crossing API returned invalid JSON");
  }

  if (data.errorCode || data.message) {
    throw new Error(`Visual Crossing API error: ${data.message ?? data.errorCode ?? "unknown"}`);
  }

  return data;
}

export async function fetchHistoricalHourlyWeather(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<VisualCrossingHourlyRow[]> {
  const data = await fetchTimelineJson({
    lat,
    lon,
    startDate,
    endDate,
    include: "hours",
    elements: "datetimeEpoch,temp,cloudcover,solarradiation",
  });
  const out: VisualCrossingHourlyRow[] = [];
  for (const day of data.days ?? []) {
    for (const hour of day.hours ?? []) {
      const epochSeconds = Number(hour.datetimeEpoch);
      if (!Number.isFinite(epochSeconds)) continue;
      out.push({
        timestampUtc: new Date(epochSeconds * 1000),
        temperatureC: toNum(hour.temp),
        cloudcoverPct: toNum(hour.cloudcover),
        solarRadiation: toNum(hour.solarradiation),
      });
    }
  }
  return out;
}

export async function fetchHistoricalDailyTemperatures(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<VisualCrossingDailyTemperatureRow[]> {
  const data = await fetchTimelineJson({
    lat,
    lon,
    startDate,
    endDate,
    include: "days",
    elements: "datetime,temp,tempmin,tempmax",
  });
  return (data.days ?? []).map((day) => ({
    dateKey: String(day.datetime ?? "").slice(0, 10),
    temperatureMeanC: toNum(day.temp),
    temperatureMinC: toNum(day.tempmin),
    temperatureMaxC: toNum(day.tempmax),
  }));
}
