/**
 * Open-Meteo Archive API client. No API key required.
 * Used only via weatherService — simulator must never call this directly.
 */

const ARCHIVE_BASE = "https://archive-api.open-meteo.com/v1/archive";
const HISTORICAL_NORMALS_MODEL = "era5";

export type OpenMeteoHourlyRow = {
  timestampUtc: Date;
  temperatureC: number | null;
  cloudcoverPct: number | null;
  solarRadiation: number | null;
};

export type OpenMeteoDailyTemperatureRow = {
  dateKey: string;
  temperatureMeanC: number | null;
  temperatureMinC: number | null;
  temperatureMaxC: number | null;
};

type ArchiveResponse = {
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
    cloudcover?: (number | null)[];
    shortwave_radiation?: (number | null)[];
  };
  daily?: {
    time?: string[];
    temperature_2m_mean?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    temperature_2m_max?: (number | null)[];
  };
  error?: boolean;
  reason?: string;
};

function parseIsoToDate(s: string): Date {
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : new Date(NaN);
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchArchiveJson(params: URLSearchParams): Promise<ArchiveResponse> {
  const url = `${ARCHIVE_BASE}?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`Open-Meteo fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Open-Meteo API error ${res.status}: ${text.slice(0, 200)}`);
  }

  let data: ArchiveResponse;
  try {
    data = (await res.json()) as ArchiveResponse;
  } catch {
    throw new Error("Open-Meteo API returned invalid JSON");
  }

  if (data.error && data.reason) {
    throw new Error(`Open-Meteo API error: ${data.reason}`);
  }

  return data;
}

/**
 * Fetch historical hourly weather from Open-Meteo Archive API.
 * Returns normalized rows; handles API errors gracefully.
 */
export async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<OpenMeteoHourlyRow[]> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: startDate.slice(0, 10),
    end_date: endDate.slice(0, 10),
    hourly: "temperature_2m,cloudcover,shortwave_radiation",
    timezone: "UTC",
  });
  const data = await fetchArchiveJson(params);

  const hourly = data.hourly;
  if (!hourly?.time?.length) {
    return [];
  }

  const times = hourly.time;
  const temp = hourly.temperature_2m ?? [];
  const cloud = hourly.cloudcover ?? [];
  const solar = hourly.shortwave_radiation ?? [];

  const rows: OpenMeteoHourlyRow[] = [];
  for (let i = 0; i < times.length; i++) {
    rows.push({
      timestampUtc: parseIsoToDate(times[i]!),
      temperatureC: toNum(temp[i]),
      cloudcoverPct: toNum(cloud[i]),
      solarRadiation: toNum(solar[i]),
    });
  }
  return rows;
}

/**
 * Fetch historical daily temperatures from Open-Meteo Archive API.
 * Used to build real long-term-average rows from prior actual years.
 */
export async function fetchHistoricalDailyTemperatures(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<OpenMeteoDailyTemperatureRow[]> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: startDate.slice(0, 10),
    end_date: endDate.slice(0, 10),
    daily: "temperature_2m_mean,temperature_2m_min,temperature_2m_max",
    timezone: "UTC",
    models: HISTORICAL_NORMALS_MODEL,
  });
  const data = await fetchArchiveJson(params);
  const daily = data.daily;
  if (!daily?.time?.length) {
    return [];
  }

  const rows: OpenMeteoDailyTemperatureRow[] = [];
  const times = daily.time;
  const mean = daily.temperature_2m_mean ?? [];
  const min = daily.temperature_2m_min ?? [];
  const max = daily.temperature_2m_max ?? [];

  for (let i = 0; i < times.length; i++) {
    const dateKey = String(times[i] ?? "").slice(0, 10);
    rows.push({
      dateKey,
      temperatureMeanC: toNum(mean[i]),
      temperatureMinC: toNum(min[i]),
      temperatureMaxC: toNum(max[i]),
    });
  }
  return rows;
}
