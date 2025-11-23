import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { SmtAuthorizationForm } from "@/components/smt/SmtAuthorizationForm";

type ExistingSmtAuthorization = {
  id: string;
  createdAt: Date;
  smtStatus: string | null;
  smtStatusMessage: string | null;
  smtAgreementId: string | null;
  smtSubscriptionId: string | null;
  subscriptionAlreadyActive?: boolean | null;
  meterNumber?: string | null;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ApiConnectPage() {
  const cookieStore = cookies();
  const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;

  const prismaAny = prisma as any;

  let user: { id: string; email: string } | null = null;
  if (sessionEmail) {
    const normalizedEmail = normalizeEmail(sessionEmail);
    user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true },
    });
  }

  let houseAddress: any | null = null;
  if (user) {
    houseAddress = await prisma.houseAddress.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        houseId: true,
        addressLine1: true,
        addressLine2: true,
        addressCity: true,
        addressState: true,
        addressZip5: true,
        esiid: true,
        tdspSlug: true,
        utilityName: true,
      },
    });
  }

  const userEmail = user?.email ?? "";

  let existingAuth: ExistingSmtAuthorization | null = null;
  if (user && houseAddress) {
    existingAuth = (await prismaAny.smtAuthorization.findFirst({
      where: { userId: user.id, houseAddressId: houseAddress.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        smtStatus: true,
        smtStatusMessage: true,
        smtAgreementId: true,
        smtSubscriptionId: true,
        meterNumber: true,
      },
    })) as ExistingSmtAuthorization | null;
  }

  const existingAuthStatus =
    existingAuth && "smtStatus" in existingAuth
      ? ((existingAuth as any).smtStatus as string | null | undefined)
      : null;
  const existingAuthStatusMessage =
    existingAuth && "smtStatusMessage" in existingAuth
      ? ((existingAuth as any).smtStatusMessage as string | null | undefined)
      : null;

  const normalizeTitle = (value: string | null | undefined) => {
    if (!value) {
      return "";
    }
    return value
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  };

  const normalizedStatus = (existingAuthStatus ?? "").toLowerCase();
  const subscriptionAlreadyActive =
    existingAuth?.subscriptionAlreadyActive === true ||
    normalizedStatus === "already_active" ||
    (existingAuthStatusMessage ?? "").toLowerCase().includes("already active");

  const ok =
    normalizedStatus === "active" ||
    normalizedStatus === "already_active" ||
    subscriptionAlreadyActive;
  const isFreshSuccess = ok && !subscriptionAlreadyActive && normalizedStatus === "active";
  const isAlreadyActiveSuccess = ok && subscriptionAlreadyActive;
  const isError = normalizedStatus === "error";
  const isPending = normalizedStatus === "pending";

  let statusLabel: string | null = null;
  let statusTone: "success" | "warning" | "error" | "neutral" = "neutral";
  let statusMessage: string | null = null;
  let statusSecondaryMessage: string | null = null;

  if (existingAuth) {
    if (isAlreadyActiveSuccess) {
      statusLabel = "Already Active";
      statusTone = "success";
      statusMessage =
        "Your Smart Meter Texas subscription is already active for this meter. We're good to go.";
      if (
        existingAuthStatusMessage &&
        !existingAuthStatusMessage.toLowerCase().includes("already active")
      ) {
        statusSecondaryMessage = existingAuthStatusMessage;
      }
    } else if (isFreshSuccess) {
      statusLabel = "Connected";
      statusTone = "success";
      statusMessage =
        existingAuthStatusMessage && existingAuthStatusMessage.trim().length > 0
          ? existingAuthStatusMessage
          : "SMT authorization is active. We’ll start pulling your usage and billing data shortly.";
    } else if (isError) {
      statusLabel = "Error";
      statusTone = "error";
      statusMessage =
        existingAuthStatusMessage && existingAuthStatusMessage.trim().length > 0
          ? existingAuthStatusMessage
          : "We couldn't complete your Smart Meter Texas authorization. Please try again or contact support.";
    } else if (isPending) {
      statusLabel = "Pending";
      statusTone = "warning";
      statusMessage =
        existingAuthStatusMessage && existingAuthStatusMessage.trim().length > 0
          ? existingAuthStatusMessage
          : "We're finalizing your Smart Meter Texas authorization. This usually completes within a minute.";
    } else if (normalizedStatus) {
      statusLabel = normalizeTitle(existingAuthStatus ?? "");
      statusTone = "neutral";
      statusMessage =
        existingAuthStatusMessage && existingAuthStatusMessage.trim().length > 0
          ? existingAuthStatusMessage
          : null;
    }
  }

  const statusBadgeStyles = {
    success: "rounded-full bg-brand-cyan/20 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-brand-cyan",
    warning: "rounded-full bg-amber-500/20 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-amber-200",
    error: "rounded-full bg-rose-500/20 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-rose-200",
    neutral: "rounded-full bg-brand-cyan/15 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-brand-cyan",
  } as const;

  const hasEsiid = Boolean(houseAddress?.esiid);
  const rawTdspValues = houseAddress
    ? [
        houseAddress.tdspSlug,
        (houseAddress as Record<string, any>)?.tdsp,
        houseAddress.utilityName,
        (houseAddress as Record<string, any>)?.utility?.name,
      ].filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];
  const hasTdspOrUtility = rawTdspValues.length > 0;

  const tdspName =
    rawTdspValues.length > 0 ? String(rawTdspValues[0]).trim() : "Unknown Utility";
  const tdspCode = houseAddress?.tdspSlug
    ? String(houseAddress.tdspSlug).toUpperCase()
    : rawTdspValues.length > 0
    ? String(rawTdspValues[0]).replace(/\s+/g, "_").toUpperCase()
    : "UNKNOWN";

  const serviceAddressLine1 =
    (houseAddress as any)?.addressLine1 ??
    (houseAddress as any)?.line1 ??
    (houseAddress as any)?.street ??
    "";
  const rawLine2 = (houseAddress as any)?.addressLine2 ?? (houseAddress as any)?.line2 ?? null;
  const serviceAddressLine2 =
    rawLine2 && String(rawLine2).trim().length > 0 ? String(rawLine2).trim() : null;
  const serviceCity = (houseAddress as any)?.addressCity ?? (houseAddress as any)?.city ?? "";
  const serviceState = (houseAddress as any)?.addressState ?? (houseAddress as any)?.state ?? "";
  const serviceZip =
    (houseAddress as any)?.addressZip5 ??
    (houseAddress as any)?.zip5 ??
    (houseAddress as any)?.postalCode ??
    "";

  const readyForSmt = Boolean(user && houseAddress && hasEsiid && hasTdspOrUtility);

  return (
    <div className="min-h-[calc(100vh-120px)] bg-slate-50/60 py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 sm:px-6 lg:px-0">
        <section
          id="smt"
          className="relative overflow-hidden rounded-3xl border border-brand-navy/10 bg-white shadow-[0_28px_80px_rgba(16,46,90,0.08)]"
        >
          <div className="pointer-events-none absolute inset-x-0 -top-48 h-72 bg-gradient-to-br from-brand-blue/20 via-white to-brand-cyan/10 blur-3xl opacity-80" />
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 bg-gradient-to-bl from-brand-cyan/10 via-transparent to-brand-blue/10 md:block" />

          <div className="relative z-10 flex flex-col gap-10 p-8 sm:p-10">
            <header className="space-y-4">
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-blue/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-blue">
                Utility Integrations
              </span>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
                  Connect Smart Meter Texas
                </h1>
                <p className="max-w-2xl text-sm leading-relaxed text-brand-slate">
                  Authorize IntelliWatt to sync with your utility&apos;s smart meter. We only use this
                  secure connection to pull usage and billing intervals so plan insights stay accurate
                  automatically.
                </p>
              </div>
            </header>

            <div className="space-y-4">
              {!user && (
                <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                  Sign in to connect Smart Meter Texas.
                </div>
              )}

              {user && !houseAddress && (
                <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                  We don’t have a service address on file yet. Add your address first and then return
                  here to authorize SMT.
                </div>
              )}

              {user && houseAddress && !hasEsiid && (
                <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                  We have your address, but we couldn’t resolve an ESIID yet. Complete the rate lookup
                  step so we can match you with the correct utility meter.
                </div>
              )}

              {user && houseAddress && hasEsiid && !hasTdspOrUtility && (
                <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                  We found an ESIID, but utility details are still syncing. Once the TDSP information
                  appears, you’ll be ready to authorize SMT.
                </div>
              )}
            </div>

            {readyForSmt && (
              <div className="space-y-6 rounded-3xl border border-brand-navy/15 bg-white/90 p-8 shadow-[0_18px_60px_rgba(16,46,90,0.06)] backdrop-blur">
                <div className="grid gap-6 lg:grid-cols-[1.1fr,1fr] lg:items-start">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-brand-cyan/40 bg-brand-navy p-6 text-sm text-brand-cyan shadow-[0_10px_30px_rgba(16,182,231,0.18)]">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                          <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-cyan">
                            Service address on file
                          </h2>
                          <div className="space-y-0.5 text-brand-cyan">
                            <div>{serviceAddressLine1}</div>
                            {serviceAddressLine2 ? <div>{serviceAddressLine2}</div> : null}
                            <div>
                              {serviceCity}, {serviceState} {serviceZip}
                            </div>
                            <div>
                              <span className="font-semibold">ESIID · </span>
                              {houseAddress.esiid ?? "—"}
                            </div>
                            <div>
                              <span className="font-semibold">Utility · </span>
                              {tdspName ?? "—"}
                            </div>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-cyan">
                            Utility integrations
                          </h3>
                          <div className="space-y-0.5">
                            <div>
                              <span className="font-semibold">Contact Email · </span>
                              {userEmail || "—"}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {existingAuth && (
                      <div className="rounded-2xl border border-brand-cyan/40 bg-brand-navy p-6 text-xs text-brand-cyan shadow-[0_10px_30px_rgba(16,182,231,0.18)]">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-[0.7rem] font-semibold uppercase tracking-wide">
                            SMT authorization last submitted{" "}
                            {existingAuth.createdAt.toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                          {statusLabel ? (
                            <span className={statusBadgeStyles[statusTone]}>{statusLabel}</span>
                          ) : null}
                        </div>
                        {statusMessage ? (
                          <p className="mt-2 text-xs leading-relaxed text-brand-cyan/90">{statusMessage}</p>
                        ) : null}
                        {statusSecondaryMessage ? (
                          <p className="mt-1 text-xs leading-relaxed text-brand-cyan/80">{statusSecondaryMessage}</p>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-brand-blue/10 bg-white/80 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                    <SmtAuthorizationForm
                      contactEmail={userEmail}
                      houseAddressId={houseAddress.id}
                      houseId={houseAddress.houseId ?? undefined}
                      esiid={houseAddress.esiid ?? undefined}
                      tdspCode={tdspCode}
                      tdspName={tdspName}
                      serviceAddressLine1={serviceAddressLine1}
                      serviceAddressLine2={serviceAddressLine2}
                      serviceCity={serviceCity}
                      serviceState={serviceState}
                      serviceZip={serviceZip}
                      existingAuth={existingAuth}
                      initialMeterNumber={existingAuth?.meterNumber ?? undefined}
                      showHeader={false}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="relative overflow-hidden rounded-3xl border border-brand-blue/15 bg-white shadow-[0_24px_70px_rgba(16,46,90,0.06)]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-blue/10 via-transparent to-brand-cyan/15 opacity-70" />
          <div className="relative z-10 flex flex-col gap-6 p-8 sm:p-10">
            <div className="flex flex-col gap-3">
              <h2 className="text-2xl font-semibold tracking-tight text-brand-navy">Smart Home Devices</h2>
              <p className="max-w-3xl text-sm leading-relaxed text-brand-slate">
                Connect your Emporia Vue, Sense, Nest, Tesla, or Enphase devices to unlock richer
                insights and earn bonus jackpot entries. Device integrations are rolling out soon—get
                on the early access list so you’re first in line.
              </p>
            </div>

            <div className="flex flex-col gap-4 rounded-2xl border border-brand-blue/20 bg-gradient-to-r from-brand-blue/15 via-brand-cyan/10 to-brand-blue/5 px-6 py-6 text-center text-brand-navy shadow-[0_12px_32px_rgba(16,46,90,0.12)] sm:flex-row sm:items-center sm:justify-between sm:text-left">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-blue">
                  Coming Soon
                </p>
                <p className="mt-2 text-base font-medium text-brand-navy">
                  Automatic OAuth logins and synced device APIs are on the way.
                </p>
              </div>
              <div className="flex justify-center sm:justify-end">
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-blue shadow-[0_10px_30px_rgba(16,46,90,0.08)]">
                  Preview Access
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
} 