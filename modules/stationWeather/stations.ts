type StationSeed = {
  code: string;
  name: string;
  lat: number;
  lon: number;
};

export const STATION_SEEDS: StationSeed[] = [
  { code: "DFW", name: "Dallas/Fort Worth International", lat: 32.8998, lon: -97.0403 },
  { code: "DAL", name: "Dallas Love Field", lat: 32.8471, lon: -96.8517 },
  { code: "AFW", name: "Fort Worth Alliance", lat: 32.9876, lon: -97.3188 },
];

const EARTH_RADIUS_MILES = 3958.7613;

function toRad(n: number): number {
  return (n * Math.PI) / 180;
}

export function haversineMiles(args: {
  lat1: number;
  lon1: number;
  lat2: number;
  lon2: number;
}): number {
  const dLat = toRad(args.lat2 - args.lat1);
  const dLon = toRad(args.lon2 - args.lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(args.lat1)) * Math.cos(toRad(args.lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

export function getZipCentroidStub(zip: string): { lat: number; lon: number } | null {
  const z = String(zip ?? "").trim();
  if (z.startsWith("761")) return { lat: 32.7555, lon: -97.3308 }; // Fort Worth centroid-ish
  if (z.startsWith("752")) return { lat: 32.7767, lon: -96.797 }; // Dallas centroid-ish
  return null;
}

export function pickNearestStationCode(args: {
  lat?: number | null;
  lon?: number | null;
  zip?: string | null;
}): string {
  let lat = Number(args.lat);
  let lon = Number(args.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const centroid = getZipCentroidStub(String(args.zip ?? ""));
    if (centroid) {
      lat = centroid.lat;
      lon = centroid.lon;
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "DFW";

  let bestCode = "DFW";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const s of STATION_SEEDS) {
    const d = haversineMiles({ lat1: lat, lon1: lon, lat2: s.lat, lon2: s.lon });
    if (d < bestDistance) {
      bestDistance = d;
      bestCode = s.code;
    }
  }
  return bestCode;
}
