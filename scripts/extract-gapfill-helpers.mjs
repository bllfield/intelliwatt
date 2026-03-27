import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const routePath = path.join(root, "app/api/admin/tools/gapfill-lab/route.ts");
const outPath = path.join(root, "app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers.ts");

const lines = fs.readFileSync(routePath, "utf8").split(/\r?\n/);
const importBlock = lines.slice(0, 46).join("\n");
const typeBlock = lines.slice(47, 77).join("\n"); // GapfillLabScoredDayTruthRow
const helperBlock = lines.slice(98, 1382).join("\n"); // DateRange … buildFullReport

const header = `// Auto-extracted from route.ts — shared by POST and gapfillCompareCorePipeline.\n`;

const out = `${header}${importBlock}\n\n${typeBlock}\n\n${helperBlock}\n`;
fs.writeFileSync(outPath, out, "utf8");
console.log("Wrote", outPath, "lines", out.split("\n").length);
