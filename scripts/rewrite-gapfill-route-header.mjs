import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const routePath = path.join(root, "app/api/admin/tools/gapfill-lab/route.ts");

const lines = fs.readFileSync(routePath, "utf8").split(/\r?\n/);
const head = lines.slice(0, 46).join("\n");
const tail = lines.slice(1383).join("\n");

const importHelpers = `import {
  GapfillLabScoredDayTruthRow,
  DateRange,
  Usage365Payload,
  IntervalPoint,
  shiftIsoDateUtc,
  normalizeFifteenCurve96,
  sortedSample,
  setIntersect,
  round2,
  type CompareCoreStepKey,
  startCompareCoreTiming,
  markCompareCoreStep,
  finalizeCompareCoreTiming,
  buildHeavyTiming,
  buildSelectedDaysCoreResponseModelAssumptions,
  withTimeout,
  withRequestAbort,
  attachAbortForwarders,
  normalizeRouteError,
  type GapfillSnapshotReaderAction,
  toSnapshotReaderAction,
  buildSnapshotReaderBase,
  safeRatio,
  bucketHourBlock,
  classifyTemperatureBand,
  classifyWeatherRegime,
  topCounts,
  isValidIanaTimezone,
  getLocalHourMinuteInTimezone,
  buildUsage365Payload,
  getTravelRangesFromDb,
  REPORT_VERSION,
  TRUNCATE_LIST,
  buildFullReport,
  ROUTE_COMPARE_SHARED_TIMEOUT_MS,
  ROUTE_COMPARE_REPORT_TIMEOUT_MS,
} from "./gapfillLabRouteHelpers";
`;

const mid = `
export const dynamic = "force-dynamic";
// Vercel serverless ceiling (seconds). Keep tight: OOM/thrash can otherwise run many minutes before the
// platform kills the instance; shorter wall-clock returns a 504/classified timeout sooner on bad runs.
// Sum(shared compare + report) must stay under this with margin.
export const maxDuration = 120;
// Cooperative abort for rebuild/compare; keep sum(shared + report) under maxDuration with margin.
const ROUTE_REBUILD_SHARED_TIMEOUT_MS = 75_000;

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}
`;

fs.writeFileSync(routePath, `${head}\n${importHelpers}\n${mid}\n${tail}`, "utf8");
console.log("Rewrote route header, tail lines:", tail.split("\n").length);
