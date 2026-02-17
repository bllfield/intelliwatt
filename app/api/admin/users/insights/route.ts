import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";

export const dynamic = "force-dynamic";

// Keep consistent with `app/admin/magic/route.ts` + `app/api/send-admin-magic-link/route.ts`
const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

function clampInt(n: number, lo: number, hi: number): number {
  const x = Number.isFinite(n) ? Math.trunc(n) : lo;
  return Math.max(lo, Math.min(hi, x));
}

function parseTri(v: string | null): "any" | "true" | "false" {
  const s = (v ?? "").trim().toLowerCase();
  if (!s || s === "any" || s === "all") return "any";
  if (["1", "true", "yes", "y", "on"].includes(s)) return "true";
  if (["0", "false", "no", "n", "off"].includes(s)) return "false";
  return "any";
}

function boolFilter(tri: "any" | "true" | "false", v: boolean): boolean {
  if (tri === "any") return true;
  return tri === "true" ? v : !v;
}

type SortKey =
  | "joined"
  | "email"
  | "contractEnd"
  | "savingsToEndNet"
  | "savings12Net"
  | "monthlyNoEtf"
  | "hasUsage"
  | "hasSmt"
  | "switched";

function parseSort(v: string | null): SortKey {
  const s = (v ?? "").trim();
  if (s === "joined") return "joined";
  if (s === "email") return "email";
  if (s === "contractEnd") return "contractEnd";
  if (s === "savings12Net") return "savings12Net";
  if (s === "monthlyNoEtf") return "monthlyNoEtf";
  if (s === "hasUsage") return "hasUsage";
  if (s === "hasSmt") return "hasSmt";
  if (s === "switched") return "switched";
  // Default per requirements: sort by savings-until-contract-end (net ETF) when available.
  if (s === "savingsToEndNet") return "savingsToEndNet";
  return "savingsToEndNet";
}

function parseDir(v: string | null): "asc" | "desc" {
  const s = (v ?? "").trim().toLowerCase();
  return s === "asc" ? "asc" : "desc";
}

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function safeMonthlyFromTotal(total: unknown, months: unknown): number | null {
  const t = finiteNumber(total);
  const m = typeof months === "number" && Number.isFinite(months) ? months : null;
  if (t === null || m === null || m <= 0) return null;
  return t / m;
}

function daysUntil(d: Date, now: Date): number | null {
  const t = d.getTime();
  const n = now.getTime();
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null;
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.floor((t - n) / DAY_MS);
}

export async function GET(request: NextRequest) {
  try {
    // Allow either:
    // - a valid admin session cookie (normal admin UI flow), OR
    // - the strict header token gate (useful for scripts / hardening).
    if (!hasAdminSessionCookie(request)) {
      const gate = requireAdmin(request);
      if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
    }

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const hasSmt = parseTri(url.searchParams.get("hasSmt"));
    const hasUsage = parseTri(url.searchParams.get("hasUsage"));
    const switched = parseTri(url.searchParams.get("switched"));
    const sort = parseSort(url.searchParams.get("sort"));
    const dir = parseDir(url.searchParams.get("dir"));
    const page = clampInt(Number(url.searchParams.get("page") ?? "1"), 1, 10_000);
    const pageSize = clampInt(Number(url.searchParams.get("pageSize") ?? "20"), 1, 200);

    const users = await db.user.findMany({
      where: q ? { email: { contains: q, mode: "insensitive" } } : undefined,
      select: { id: true, email: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    const userIds = users.map((u) => u.id);
    const houses = userIds.length
      ? await db.houseAddress.findMany({
          where: { userId: { in: userIds }, archivedAt: null },
          select: {
            id: true,
            userId: true,
            isPrimary: true,
            createdAt: true,
            archivedAt: true,
            addressLine1: true,
            addressCity: true,
            addressState: true,
            addressZip5: true,
            esiid: true,
            tdspSlug: true,
            utilityName: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

    const primaryHouseByUser = new Map<string, (typeof houses)[number]>();
    for (const h of houses) {
      const cur = primaryHouseByUser.get(h.userId);
      if (!cur) {
        primaryHouseByUser.set(h.userId, h);
        continue;
      }
      // Prefer explicit primary home; otherwise keep newest.
      if (!cur.isPrimary && h.isPrimary) {
        primaryHouseByUser.set(h.userId, h);
        continue;
      }
    }

    const primaryHouseIds = Array.from(
      new Set(
        users
          .map((u) => primaryHouseByUser.get(u.id)?.id ?? null)
          .filter((x): x is string => Boolean(x)),
      ),
    );

    const snapshots = primaryHouseIds.length
      ? await (db as any).homeSavingsSnapshot.findMany({
          where: { houseAddressId: { in: primaryHouseIds } },
          select: {
            houseAddressId: true,
            computedAt: true,
            contractEndDate: true,
            monthsRemainingOnContract: true,
            earlyTerminationFeeDollars: true,
            wouldIncurEtfIfSwitchNow: true,
            savingsNext12MonthsNoEtf: true,
            savingsUntilContractEndNoEtf: true,
            savingsNext12MonthsNetEtf: true,
            savingsUntilContractEndNetEtf: true,
            currentAnnualCostDollars: true,
            bestAnnualCostDollars: true,
            bestRatePlanId: true,
            bestOfferId: true,
            bestTermMonths: true,
          },
        })
      : [];
    const snapshotByHouse = new Map<string, (typeof snapshots)[number]>();
    for (const s of snapshots) snapshotByHouse.set(String(s.houseAddressId), s);

    const now = new Date();
    const smtAuthRows = primaryHouseIds.length
      ? await db.smtAuthorization.findMany({
          where: {
            archivedAt: null,
            houseAddressId: { in: primaryHouseIds },
            // `authorizationEndDate` is required in our schema; treat "has SMT" as "has unexpired auth".
            authorizationEndDate: { gt: now },
          },
          select: { houseAddressId: true },
        })
      : [];
    const housesWithSmtAuth = new Set<string>(smtAuthRows.map((r) => String(r.houseAddressId)));

    const esiids = Array.from(
      new Set(
        primaryHouseIds
          .map((hid) => houses.find((h) => h.id === hid)?.esiid ?? null)
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0),
      ),
    );
    const smtUsageEsiids =
      esiids.length > 0
        ? await db.smtInterval.findMany({
            where: { esiid: { in: esiids } },
            select: { esiid: true },
            distinct: ["esiid"],
          })
        : [];
    const esiidsWithUsage = new Set<string>(smtUsageEsiids.map((r) => String(r.esiid)));

    const gbUploads =
      primaryHouseIds.length > 0
        ? await db.greenButtonUpload.findMany({
            where: { houseId: { in: primaryHouseIds } },
            select: { houseId: true },
            distinct: ["houseId"],
          })
        : [];
    const housesWithGb = new Set<string>(gbUploads.map((r) => String(r.houseId)));

    const commissionRows =
      userIds.length > 0
        ? await db.commissionRecord.findMany({
            where: { userId: { in: userIds } },
            select: { userId: true },
            distinct: ["userId"],
          })
        : [];
    const switchedUserIds = new Set<string>(commissionRows.map((r) => String(r.userId)));

    type Row = {
      userId: string;
      email: string;
      joinedAt: string;
      houseAddressId: string | null;
      addressLine1: string | null;
      city: string | null;
      state: string | null;
      zip5: string | null;
      esiid: string | null;
      utilityName: string | null;
      hasSmt: boolean;
      hasUsage: boolean;
      switchedWithUs: boolean;
      contractEndDate: string | null;
      savingsUntilContractEndNetEtf: number | null;
      savingsNext12MonthsNetEtf: number | null;
      savingsUntilContractEndNoEtf: number | null;
      savingsNext12MonthsNoEtf: number | null;
      etfDollars: number | null;
      wouldIncurEtfIfSwitchNow: boolean | null;
      monthlySavingsNoEtf: number | null; // dollars per month, no ETF (matches portal "Monthly savings")
      monthlySavingsBasis: "TO_CONTRACT_END" | "NEXT_12_MONTHS" | null;
      monthlySavingsBasisMonths: number | null;
      snapshotComputedAt: string | null;
    };

    const rowsAll: Row[] = users.map((u) => {
      const h = primaryHouseByUser.get(u.id) ?? null;
      const hid = h?.id ?? null;
      const snap = hid ? snapshotByHouse.get(hid) ?? null : null;
      const houseEsiid = typeof h?.esiid === "string" && h.esiid.trim() ? h.esiid.trim() : null;

      const hasSmtNow = hid ? housesWithSmtAuth.has(hid) : false;
      const hasUsageNow = Boolean(
        (houseEsiid && esiidsWithUsage.has(houseEsiid)) || (hid && housesWithGb.has(hid)),
      );
      const switchedWithUs = switchedUserIds.has(u.id);

      const contractEndDateIso = snap?.contractEndDate
        ? new Date(snap.contractEndDate).toISOString()
        : null;
      const contractEndDateObj = contractEndDateIso ? new Date(contractEndDateIso) : null;
      const withinEtfFreeWindow = (() => {
        // Mirror the portal behavior: within 14 days of contract end (or already expired)
        // treat as ETF-free switch window.
        if (!contractEndDateObj) return false;
        const d = daysUntil(contractEndDateObj, now);
        return d !== null && d <= 14;
      })();
      const monthsRemaining =
        typeof snap?.monthsRemainingOnContract === "number" && Number.isFinite(snap.monthsRemainingOnContract)
          ? snap.monthsRemainingOnContract
          : null;

      const monthlyBasisKind: Row["monthlySavingsBasis"] =
        withinEtfFreeWindow ? "NEXT_12_MONTHS" : "TO_CONTRACT_END";
      const basisMonths = withinEtfFreeWindow
        ? 12
        : (monthsRemaining && monthsRemaining > 0 ? monthsRemaining : null);

      // Portal "Monthly savings" is the no-ETF monthly delta. We approximate it as:
      // - to end window: savingsUntilContractEndNoEtf / monthsRemaining
      // - ETF-free window: savingsNext12MonthsNoEtf / 12
      // with a fallback to 12-month if monthsRemaining is missing.
      const monthlySavingsNoEtf =
        withinEtfFreeWindow
          ? (safeMonthlyFromTotal(snap?.savingsNext12MonthsNoEtf, 12) ?? null)
          : (safeMonthlyFromTotal(snap?.savingsUntilContractEndNoEtf, basisMonths) ??
              safeMonthlyFromTotal(snap?.savingsNext12MonthsNoEtf, 12) ??
              null);

      return {
        userId: u.id,
        email: u.email,
        joinedAt: u.createdAt.toISOString(),
        houseAddressId: hid,
        addressLine1: h?.addressLine1 ?? null,
        city: h?.addressCity ?? null,
        state: h?.addressState ?? null,
        zip5: h?.addressZip5 ?? null,
        esiid: houseEsiid,
        utilityName: h?.utilityName ?? null,
        hasSmt: hasSmtNow,
        hasUsage: hasUsageNow,
        switchedWithUs,
        contractEndDate: contractEndDateIso,
        savingsUntilContractEndNetEtf:
          typeof snap?.savingsUntilContractEndNetEtf === "number" && Number.isFinite(snap.savingsUntilContractEndNetEtf)
            ? snap.savingsUntilContractEndNetEtf
            : null,
        savingsNext12MonthsNetEtf:
          typeof snap?.savingsNext12MonthsNetEtf === "number" && Number.isFinite(snap.savingsNext12MonthsNetEtf)
            ? snap.savingsNext12MonthsNetEtf
            : null,
        savingsUntilContractEndNoEtf:
          typeof snap?.savingsUntilContractEndNoEtf === "number" && Number.isFinite(snap.savingsUntilContractEndNoEtf)
            ? snap.savingsUntilContractEndNoEtf
            : null,
        savingsNext12MonthsNoEtf:
          typeof snap?.savingsNext12MonthsNoEtf === "number" && Number.isFinite(snap.savingsNext12MonthsNoEtf)
            ? snap.savingsNext12MonthsNoEtf
            : null,
        etfDollars:
          typeof snap?.earlyTerminationFeeDollars === "number" && Number.isFinite(snap.earlyTerminationFeeDollars)
            ? snap.earlyTerminationFeeDollars
            : null,
        wouldIncurEtfIfSwitchNow:
          typeof snap?.wouldIncurEtfIfSwitchNow === "boolean" ? snap.wouldIncurEtfIfSwitchNow : null,
        monthlySavingsNoEtf:
          typeof monthlySavingsNoEtf === "number" && Number.isFinite(monthlySavingsNoEtf)
            ? monthlySavingsNoEtf
            : null,
        monthlySavingsBasis: monthlyBasisKind,
        monthlySavingsBasisMonths: basisMonths,
        snapshotComputedAt: snap?.computedAt ? new Date(snap.computedAt).toISOString() : null,
      };
    });

    const rowsFiltered = rowsAll.filter((r) => {
      if (!boolFilter(hasSmt, r.hasSmt)) return false;
      if (!boolFilter(hasUsage, r.hasUsage)) return false;
      if (!boolFilter(switched, r.switchedWithUs)) return false;
      return true;
    });

    const num = (v: any): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY);
    const date = (v: string | null): number => {
      if (!v) return Number.NEGATIVE_INFINITY;
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
    };
    rowsFiltered.sort((a, b) => {
      const mul = dir === "asc" ? 1 : -1;
      if (sort === "email") return mul * a.email.localeCompare(b.email);
      if (sort === "joined") return mul * (new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());
      if (sort === "contractEnd") return mul * (date(a.contractEndDate) - date(b.contractEndDate));
      if (sort === "hasUsage") return mul * (Number(a.hasUsage) - Number(b.hasUsage));
      if (sort === "hasSmt") return mul * (Number(a.hasSmt) - Number(b.hasSmt));
      if (sort === "switched") return mul * (Number(a.switchedWithUs) - Number(b.switchedWithUs));
      if (sort === "monthlyNoEtf") return mul * (num(a.monthlySavingsNoEtf) - num(b.monthlySavingsNoEtf));
      if (sort === "savings12Net") return mul * (num(a.savingsNext12MonthsNetEtf) - num(b.savingsNext12MonthsNetEtf));
      // default: savingsToEndNet
      return mul * (num(a.savingsUntilContractEndNetEtf) - num(b.savingsUntilContractEndNetEtf));
    });

    const total = rowsFiltered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const start = (safePage - 1) * pageSize;
    const out = rowsFiltered.slice(start, start + pageSize);

    return NextResponse.json({
      ok: true,
      q: q || null,
      filters: { hasSmt, hasUsage, switched },
      sort,
      dir,
      page: safePage,
      pageSize,
      total,
      totalPages,
      rows: out,
    });
  } catch (error) {
    console.error("[admin_users_insights] error", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
