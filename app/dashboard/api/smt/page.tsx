import Link from "next/link";
import { redirect } from "next/navigation";
import { loadUsageEntryContext } from "../context";
import { deriveSmtStatus, statusBadgeStyles } from "../statusHelpers";
import DashboardHero from "@/components/dashboard/DashboardHero";
import SmtAddressCaptureCard from "@/components/smt/SmtAddressCaptureCard";
import { SmtAuthorizationForm } from "@/components/smt/SmtAuthorizationForm";
import SmtManualFallbackCard from "@/components/smt/SmtManualFallbackCard";
import RefreshSmtButton from "@/components/smt/RefreshSmtButton";
import LocalTime from "@/components/LocalTime";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatServiceAddress(context: Awaited<ReturnType<typeof loadUsageEntryContext>>) {
  const house = context.houseAddress;
  if (!house) return null;
  const parts = [
    house.addressLine1 ?? "",
    house.addressLine2 ?? "",
    [house.addressCity, house.addressState, house.addressZip5]
      .filter((part) => part && part.trim().length > 0)
      .join(" "),
  ]
    .filter((part) => part && part.trim().length > 0)
    .join("\n");
  return parts.length > 0 ? parts : null;
}

export default async function UsageEntrySmartMeterPage() {
  const context = await loadUsageEntryContext();
  const { user, houseAddress, existingAuthorization } = context;

  if (!user) {
    redirect("/login?redirect=/dashboard/api/smt");
  }

  const serviceAddressDisplay = formatServiceAddress(context);

  if (!houseAddress) {
    return (
      <div className="min-h-screen bg-brand-white">
        <DashboardHero
          title="Usage Entry"
          highlight="Smart Meter Texas"
          description="Add your service address to get started. Once it’s saved, we’ll pull the right utility and ESIID so you can connect SMT in less than a minute."
        />
        <section className="bg-brand-white px-4 pb-12 pt-4">
          <div className="mx-auto w-full max-w-4xl space-y-6">
            <SmtAddressCaptureCard houseAddressId={null} initialAddress={null} />
            <Link
              href="/dashboard/api"
              className="inline-flex items-center text-sm font-semibold text-brand-blue underline-offset-4 hover:underline"
            >
              ← Back to Usage Entry hub
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const rawTdspValues = [
    houseAddress.tdspSlug,
    (houseAddress as Record<string, unknown>).tdsp as string | undefined,
    houseAddress.utilityName,
    (houseAddress as Record<string, unknown>)?.utilityName,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const tdspName =
    rawTdspValues.length > 0 ? String(rawTdspValues[0]).trim() : "Unknown Utility";
  const tdspCode = houseAddress.tdspSlug
    ? String(houseAddress.tdspSlug).toUpperCase()
    : rawTdspValues.length > 0
    ? String(rawTdspValues[0]).replace(/\s+/g, "_").toUpperCase()
    : "UNKNOWN";

  const hasEsiid = Boolean(houseAddress.esiid);
  const hasTdsp = rawTdspValues.length > 0;
  const readyForSmt = hasEsiid && hasTdsp;

  const serviceAddressLine1 = houseAddress.addressLine1 ?? "";
  const serviceAddressLine2 =
    houseAddress.addressLine2 && houseAddress.addressLine2.trim().length > 0
      ? houseAddress.addressLine2
      : null;
  const serviceCity = houseAddress.addressCity ?? "";
  const serviceState = houseAddress.addressState ?? "";
  const serviceZip = houseAddress.addressZip5 ?? "";

  const smtStatus = deriveSmtStatus(existingAuthorization);

  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Usage Entry"
        highlight="Smart Meter Texas"
        description="Authorize IntelliWatt to sync directly with your utility. We’ll pull 15-minute usage and billing history so your insights stay accurate automatically."
      />

      <section className="bg-brand-white px-4 pb-12 pt-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <Link
            href="/dashboard/api"
            className="inline-flex items-center text-sm font-semibold text-brand-blue underline-offset-4 hover:underline"
          >
            ← Back to Usage Entry hub
          </Link>

          <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
                  Service address
                </h2>
                {serviceAddressDisplay ? (
                  <div className="whitespace-pre-line text-sm leading-relaxed text-brand-cyan/90">
                    {serviceAddressDisplay}
                    {houseAddress.esiid ? (
                      <p className="mt-1 text-xs text-brand-cyan/60">
                        <span className="font-semibold text-brand-cyan/70">ESIID · </span>
                        {houseAddress.esiid}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-brand-cyan/70">
                    Add the address you want IntelliWatt to analyze. We’ll pull the correct utility and ESIID for you.
                  </p>
                )}
              </div>
              <div className="rounded-2xl border border-brand-cyan/40 bg-brand-navy px-4 py-3 text-xs text-brand-cyan/80">
                <p className="font-semibold text-brand-cyan">Need another entry?</p>
                <p className="mt-1 leading-relaxed">
                  Upload a Green Button file or log a manual placeholder when SMT isn’t ready. You can always return here to
                  refresh SMT access.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Link
                    href="/dashboard/api/green-button"
                    className="inline-flex items-center rounded-full border border-brand-cyan/40 px-3 py-1 text-brand-cyan transition hover:border-brand-cyan hover:bg-brand-navy/60"
                  >
                    Green Button upload →
                  </Link>
                  <Link
                    href="/dashboard/api/manual"
                    className="inline-flex items-center rounded-full border border-brand-cyan/40 px-3 py-1 text-brand-cyan transition hover:border-brand-cyan hover:bg-brand-navy/60"
                  >
                    Manual placeholder →
                  </Link>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <SmtAddressCaptureCard
                houseAddressId={houseAddress.id}
                initialAddress={serviceAddressDisplay}
              />
            </div>
          </div>

          {!hasEsiid ? (
            <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
              We’re still resolving the ESIID for this address. Once it appears, you can submit the SMT authorization.
            </div>
          ) : null}

          {hasEsiid && !hasTdsp ? (
            <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
              Utility information is still syncing. As soon as it resolves, you’ll be ready to authorize SMT.
            </div>
          ) : null}

          {readyForSmt ? (
            <div className="space-y-5">
              <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_18px_60px_rgba(16,46,90,0.18)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                      SMT connection status
                    </p>
                    {existingAuthorization?.createdAt ? (
                      <p className="text-xs text-brand-cyan/70">
                        Last submitted{" "}
                        <LocalTime
                          value={existingAuthorization.createdAt.toISOString()}
                          options={{ month: "short", day: "numeric", year: "numeric" }}
                          fallback="—"
                        />
                      </p>
                    ) : null}
                  </div>
                  <span className={statusBadgeStyles[smtStatus.tone]}>{smtStatus.label}</span>
                </div>
                {smtStatus.message ? (
                  <p className="mt-3 text-sm text-brand-cyan/80">{smtStatus.message}</p>
                ) : null}
                {existingAuthorization?.authorizationEndDate ? (
                  <p className="mt-2 text-xs text-brand-cyan/70">
                    Authorization expires{" "}
                    <LocalTime
                      value={existingAuthorization.authorizationEndDate.toISOString()}
                      options={{ month: "short", day: "numeric", year: "numeric" }}
                      fallback="—"
                    />
                  </p>
                ) : null}
                <div className="mt-4">
                  <RefreshSmtButton homeId={houseAddress.id} />
                </div>
              </div>

              <div className="rounded-3xl border border-brand-cyan/20 bg-white p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <SmtAuthorizationForm
                  contactEmail={context.user?.email ?? ""}
                  houseAddressId={houseAddress.id}
                  houseId={houseAddress.houseId ?? undefined}
                  esiid={houseAddress.esiid ?? undefined}
                  tdspCode={tdspCode}
                  tdspName={tdspName}
                  serviceAddressLine1={serviceAddressLine1}
                  serviceAddressLine2={serviceAddressLine2 ?? undefined}
                  serviceCity={serviceCity}
                  serviceState={serviceState}
                  serviceZip={serviceZip}
                  existingAuth={existingAuthorization ?? undefined}
                  initialMeterNumber={existingAuthorization?.meterNumber ?? undefined}
                  showHeader={false}
                />
              </div>
            </div>
          ) : null}

          <SmtManualFallbackCard houseAddressId={houseAddress.id} />
        </div>
      </section>
    </div>
  );
}

