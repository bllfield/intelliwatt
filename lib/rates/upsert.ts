// lib/rates/upsert.ts
// Step 19: Offer→Rate upsert — given a WattBuy offer, derive a stable rate key,
// fetch & parse the EFL, and upsert a RateConfig row. Also maintains OfferRateMap.
//
// Assumptions (Prisma):
// model RateConfig {
//   id                      String   @id @default(cuid())
//   key                     String   @unique // `${supplierSlug}:${planId}:${tdspSlug}`
//   supplierSlug            String
//   planId                  String
//   tdspSlug                String
//   supplierName            String?
//   planName                String?
//   termMonths              Int?
//   eflUrl                  String?
//   tosUrl                  String?
//   yracUrl                 String?
//   baseMonthlyFeeCents     Int?
//   tduDeliveryCentsPerKwh  Float?
//   centsPerKwhJson         Json?
//   billCreditsJson         Json?
//   touWindowsJson          Json?
//   avgPrice500             Float?
//   avgPrice1000            Float?
//   avgPrice2000            Float?
//   isGreen                 Boolean?
//   greenPct                Int?
//   cancelFeeCents          Int?
//   isFixed                 Boolean?
//   isVariable              Boolean?
//   eflHash                 String?  // sha256 of raw fetched payload
//   fetchedAt               DateTime?
//   createdAt               DateTime @default(now())
//   updatedAt               DateTime @updatedAt
// }
//
// model OfferRateMap {
//   id            String   @id @default(cuid())
//   offerId       String   @unique
//   rateKey       String
//   supplierSlug  String
//   planId        String
//   tdspSlug      String
//   lastSeenAt    DateTime @default(now())
// }
//
// If your schema differs, adjust the field names below accordingly.

import { deriveRateKey, getRateKeyParts } from '@/lib/rates/key';
import { WattBuyOffer } from '@/lib/offers/match';
import { fetchEflText } from '@/lib/efl/fetch';
import { parseEflText } from '@/lib/efl/parse';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type UpsertResult =
  | {
      ok: true;
      rateKey: string;
      rateConfigId: string;
      updated: boolean;            // true if EFL changed or we created a new row
      reason?: string;
    }
  | {
      ok: false;
      error: string;
      rateKey?: string | null;
    };

export async function upsertRateFromOffer(
  offer: WattBuyOffer,
  opts?: { force?: boolean }
): Promise<UpsertResult> {
  try {
    // Build the canonical key
    const rateKey = deriveRateKey(offer);
    if (!rateKey) return { ok: false, error: 'Missing supplier/plan_id/utility on offer.', rateKey };

    const { supplier, planId, tdsp } = getRateKeyParts(offer);
    if (!supplier || !planId || !tdsp) {
      return { ok: false, error: 'Incomplete rate key parts.', rateKey };
    }

    // Find existing record (if any)
    const existing = await prisma.rateConfig.findUnique({ where: { key: rateKey } });

    // 1) Try to fetch & parse EFL if we have a URL
    const eflUrl =
      offer.offer_data?.efl ||
      // Some REPs expose alternate doc locations; keep the explicit URL if present
      undefined;

    let fetched:
      | {
          text: string;
          fromPdf: boolean;
          hash: string;
          contentType: string;
          bytes: number;
        }
      | null = null;

    let parsed:
      | ReturnType<typeof parseEflText>
      | null = null;

    if (eflUrl) {
      try {
        const f = await fetchEflText(eflUrl);
        fetched = {
          text: f.text,
          fromPdf: f.fromPdf,
          hash: f.hash,
          contentType: f.contentType,
          bytes: f.bytes,
        };

        // If nothing changed and not forcing, skip heavy update
        if (!opts?.force && existing?.eflHash && existing.eflHash === f.hash) {
          // Update OfferRateMap timestamp and return fast
          await upsertOfferMap(offer, rateKey, supplier, planId, tdsp);
          return {
            ok: true,
            rateKey,
            rateConfigId: existing.id,
            updated: false,
            reason: 'EFL unchanged (hash match)',
          };
        }

        parsed = parseEflText(f.text, {
          eflUrl,
          tdspSlug: tdsp,
          supplierSlug: supplier,
          supplierName: offer.offer_data?.supplier_name,
          planName: offer.offer_name,
          planId: String(planId),
          tosUrl: offer.offer_data?.tos,
          yracUrl: offer.offer_data?.yrac,
        });
      } catch (e: any) {
        // If EFL fetch fails, we'll still persist a skeletal row from offer metadata.
        console.warn(`EFL fetch/parse failed for ${rateKey}:`, e?.message || e);
      }
    }

    // 2) Build the payload to upsert (merge parsed EFL + WattBuy fallbacks)
    const basePayload = {
      key: rateKey,
      supplierSlug: supplier,
      planId: String(planId),
      tdspSlug: tdsp,
      supplierName: offer.offer_data?.supplier_name ?? capFirst(supplier),
      planName: offer.offer_name || offer.offer_data?.name_id || null,
      termMonths: offer.offer_data?.term ?? parsed?.rate.termMonths ?? null,
      eflUrl: eflUrl ?? parsed?.rate.eflUrl ?? null,
      tosUrl: parsed?.rate.tosUrl ?? offer.offer_data?.tos ?? null,
      yracUrl: parsed?.rate.yracUrl ?? offer.offer_data?.yrac ?? null,

      baseMonthlyFeeCents: parsed?.rate.baseMonthlyFeeCents ?? null,
      tduDeliveryCentsPerKwh: parsed?.rate.tduDeliveryCentsPerKwh ?? null,
      centsPerKwhJson: parsed?.rate.centsPerKwhJson ?? undefined,
      billCreditsJson: parsed?.rate.billCreditsJson ?? undefined,
      touWindowsJson: parsed?.rate.touWindowsJson ?? undefined,

      avgPrice500: parsed?.rate.avgPrice500 ?? offer.offer_data?.kwh500 ?? null,
      avgPrice1000: parsed?.rate.avgPrice1000 ?? offer.offer_data?.kwh1000 ?? null,
      avgPrice2000: parsed?.rate.avgPrice2000 ?? offer.offer_data?.kwh2000 ?? null,

      isGreen: parsed?.rate.isGreen ?? toBool(offer.offer_data?.is_green),
      greenPct:
        parsed?.rate.greenPct ??
        (typeof offer.offer_data?.green_percentage === 'number'
          ? Math.round(offer.offer_data!.green_percentage)
          : null),
      cancelFeeCents: parsed?.rate.cancelFeeCents ?? parseCancelFee(offer.offer_data?.cancel_notes),
      isFixed:
        parsed?.rate.isFixed ??
        (typeof offer.offer_data?.is_fixed === 'boolean' ? offer.offer_data!.is_fixed : null),
      isVariable:
        parsed?.rate.isVariable ??
        (typeof offer.offer_data?.is_variable === 'boolean' ? offer.offer_data!.is_variable : null),

      eflHash: fetched?.hash ?? existing?.eflHash ?? null,
      fetchedAt: fetched ? new Date() : existing?.fetchedAt ?? null,
    };

    // 3) Upsert RateConfig
    const upserted = await prisma.rateConfig.upsert({
      where: { key: rateKey },
      update: basePayload,
      create: basePayload,
      select: { id: true },
    });

    // 4) Upsert OfferRateMap (offer_id → rateKey)
    await upsertOfferMap(offer, rateKey, supplier, planId, tdsp);

    const updated = !existing || (fetched && fetched.hash !== existing.eflHash) || !!opts?.force;
    return { ok: true, rateKey, rateConfigId: upserted.id, updated };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Upsert failed.' };
  }
}

// --------- batch helper (for nightly refresh) ---------

export async function upsertRatesFromOffers(
  offers: WattBuyOffer[],
  opts?: { force?: boolean; concurrency?: number }
) {
  const c = Math.max(1, Math.min(8, opts?.concurrency ?? 3));
  const queue = offers.slice();
  const results: UpsertResult[] = [];

  async function worker() {
    while (queue.length) {
      const offer = queue.shift()!;
      try {
        const res = await upsertRateFromOffer(offer, { force: opts?.force });
        results.push(res);
      } catch (e: any) {
        results.push({ ok: false, error: e?.message || 'Worker failed.' });
      }
    }
  }

  await Promise.all(Array.from({ length: c }, () => worker()));
  return results;
}

// --------- internals ---------

async function upsertOfferMap(
  offer: WattBuyOffer,
  rateKey: string,
  supplier: string,
  planId: string,
  tdsp: string
) {
  const offerId = offer.offer_id;
  if (!offerId) return;

  await prisma.offerRateMap.upsert({
    where: { offerId },
    update: { rateKey, supplierSlug: supplier, planId: String(planId), tdspSlug: tdsp, lastSeenAt: new Date() },
    create: { offerId, rateKey, supplierSlug: supplier, planId: String(planId), tdspSlug: tdsp },
  });
}

function capFirst(s?: string | null) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toBool(v: any): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function parseCancelFee(s?: string | null): number | null {
  if (!s) return null;
  // "$150" or "$15/month remaining"
  const m = s.match(/(\d{1,4})(?:\s*\/\s*month)?/i);
  if (!m) return null;
  const dollars = Number(m[1]);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}
