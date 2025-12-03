import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { SmtAuthorizationForm } from "@/components/smt/SmtAuthorizationForm";
import SmtAddressCaptureCard from "@/components/smt/SmtAddressCaptureCard";
import SmtManualFallbackCard from "@/components/smt/SmtManualFallbackCard";
import DashboardHero from "@/components/dashboard/DashboardHero";
import LocalTime from "@/components/LocalTime";
import GreenButtonUtilitiesCard from "@/components/dashboard/GreenButtonUtilitiesCard";

function GreenButtonInstructions() {
  return (
    <div
      id="green-button-instructions"
      className="rounded-3xl border-2 border-brand-navy bg-white p-6 shadow-[0_24px_70px_rgba(16,46,90,0.08)] sm:p-8"
    >
      <div className="space-y-4 text-sm leading-relaxed text-brand-slate">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-brand-navy">
            Green Button usage data
          </h2>
          <p className="mt-2">
            Green Button is a standardized download offered by many utilities so you can export the
            same detailed usage history they see internally. Uploading it here lets IntelliWatt analyze
            your real consumption patterns without waiting on Smart Meter Texas.
          </p>
        </div>

        <div className="space-y-2 text-brand-navy">
          <p className="font-semibold">How to download your Green Button file</p>
          <ol className="list-decimal list-inside space-y-1 text-brand-slate">
            <li>Log in to your electric utility’s online account.</li>
            <li>
              Browse to sections labeled{" "}
              <span className="font-semibold">Usage</span>,{" "}
              <span className="font-semibold">Energy Use</span>,{" "}
              <span className="font-semibold">Usage History</span>, or a{" "}
              <span className="font-semibold">Green Button / Download My Data</span> link.
            </li>
            <li>
              When prompted for a date range, choose the{" "}
              <span className="font-semibold">last 12 months</span> whenever possible. For newer homes,
              export as much history as you have.
            </li>
            <li>
              Download the file—preferably the Green Button{" "}
              <span className="font-semibold">XML</span>. If XML isn’t offered, download the available
              Green Button CSV instead.
            </li>
            <li>
              Return to the <span className="font-semibold">Green Button Upload</span> step below and
              upload that file so we can run the analysis.
            </li>
          </ol>
        </div>

        <div className="space-y-1 text-brand-navy">
          <p className="font-semibold">How much data should I upload?</p>
          <p className="text-brand-slate">
            Uploading a full <span className="font-semibold">12 months</span> captures both summer and
            winter usage peaks. If you do not have a year of history yet, send everything available—we
            will still model your savings using what you provide.
          </p>
        </div>

        <div className="space-y-1 text-brand-navy">
          <p className="font-semibold">If you can’t find Green Button</p>
          <p className="text-brand-slate">
            Utilities sometimes relabel it as{" "}
            <span className="font-semibold">Energy Insights</span>,{" "}
            <span className="font-semibold">Usage History</span>, or{" "}
            <span className="font-semibold">Download My Usage</span>. If you still can’t locate an
            export, contact your utility’s support team and ask how to download your data in Green
            Button format.
          </p>
        </div>
      </div>
    </div>
  );
}

type ExistingSmtAuthorization = {
  id: string;
  createdAt: Date;
  smtStatus: string | null;
  smtStatusMessage: string | null;
  smtAgreementId: string | null;
  smtSubscriptionId: string | null;
  subscriptionAlreadyActive?: boolean | null;
  meterNumber?: string | null;
  authorizationStartDate?: Date | null;
  authorizationEndDate?: Date | null;
  archivedAt?: Date | null;
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
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
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
        isPrimary: true,
        archivedAt: true,
      } as any,
    });

    if (!houseAddress) {
      houseAddress = await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null } as any,
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
          isPrimary: true,
          archivedAt: true,
        } as any,
      });
    }
  }

  const userEmail = user?.email ?? "";
  const userProfile =
    user &&
    (await prisma.userProfile.findUnique({
      where: { userId: user.id },
      select: {
        esiidAttentionRequired: true,
        esiidAttentionCode: true,
        esiidAttentionAt: true,
      },
    }));
  const displacedAttention =
    Boolean(userProfile?.esiidAttentionRequired) && userProfile?.esiidAttentionCode === "smt_replaced";

  let existingAuth: ExistingSmtAuthorization | null = null;
  if (user && houseAddress) {
    existingAuth = (await prismaAny.smtAuthorization.findFirst({
      where: {
        userId: user.id,
        houseAddressId: houseAddress.id,
        archivedAt: null,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        smtStatus: true,
        smtStatusMessage: true,
        smtAgreementId: true,
        smtSubscriptionId: true,
        meterNumber: true,
        authorizationStartDate: true,
        authorizationEndDate: true,
        archivedAt: true,
      } as any,
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
  const hasActiveAuthorization = ok;

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
  const serviceAddressDisplay = houseAddress
    ? [
        serviceAddressLine1,
        serviceAddressLine2,
        [serviceCity, serviceState, serviceZip].filter((part) => part && String(part).trim().length > 0).join(", "),
      ]
        .filter((part) => typeof part === "string" && part.trim().length > 0)
        .join("\n")
    : null;
  const showAddressCaptureCard = Boolean(user) && !hasActiveAuthorization;

  return (
    <div id="smt" className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Connect"
        highlight="Smart Meter Texas"
        description="Authorize IntelliWatt to sync with your utility’s smart meter. We only use this secure connection to pull usage and billing intervals so plan insights stay accurate automatically."
      />

      <section className="bg-brand-white pt-3 pb-8 px-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          {displacedAttention ? (
            <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-5 py-4 text-sm text-brand-navy shadow-[0_18px_45px_rgba(190,18,60,0.18)]">
              Another IntelliWatt household just connected this Smart Meter Texas meter. Your previous authorization was
              removed, so add your current service address again below to reconnect and earn entries.
            </div>
          ) : null}

          {!existingAuth && (
            <div className="flex flex-col items-center gap-4 text-center">
              <a
                href="https://www.hitthejackwatt.com"
                target="_blank"
                rel="noopener noreferrer"
                className="relative inline-block h-24 w-full max-w-xs sm:h-28 sm:max-w-sm md:h-24 md:w-64"
              >
                <Image
                  src="/Hitthejackwatt-Logo.png"
                  alt="HitTheJackWatt™"
                  fill
                  className="object-contain"
                  priority
                />
              </a>
              <div className="inline-flex w-full max-w-xl flex-col items-center gap-2 rounded-2xl border border-[#39FF14]/40 bg-[#39FF14]/10 px-5 py-3 text-center shadow-lg shadow-[#39FF14]/15 ring-1 ring-[#39FF14]/25">
                <span className="text-base font-extrabold leading-tight text-brand-navy md:text-lg">
                  <span style={{ color: '#39FF14' }}>⚡ Connect your smart meter data</span>
                  <span className="mx-1 text-brand-navy">for</span>
                  <span style={{ color: '#39FF14' }}>1 jackpot entry!</span>
                </span>
                <span className="text-sm font-bold leading-tight text-brand-navy md:text-base">
                  <Link href="/dashboard/referrals" style={{ color: '#BF00FF' }} className="hover:underline">
                    👥 Refer a Friend:
                  </Link>
                  <span className="mx-1 text-brand-navy" />
                  <span style={{ color: '#39FF14' }}>1 jackpot entry per signup!</span>
                </span>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {!user && (
              <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-center text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                Sign in to connect Smart Meter Texas.
              </div>
            )}

            {user && !houseAddress && (
              <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-center text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                We don’t have a service address on file yet. Add your address first and then return here to authorize SMT.
              </div>
            )}

            {user && houseAddress && !hasEsiid && (
              <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-center text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                We have your address, but we couldn’t resolve an ESIID yet. Complete the rate lookup step so we can match you with the correct utility meter.
              </div>
            )}

            {user && houseAddress && hasEsiid && !hasTdspOrUtility && (
              <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-center text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                We found an ESIID, but utility details are still syncing. Once the TDSP information appears, you’ll be ready to authorize SMT.
              </div>
            )}
          </div>

          <GreenButtonInstructions />
          <GreenButtonUtilitiesCard />

          {showAddressCaptureCard ? (
            <SmtAddressCaptureCard
              houseAddressId={houseAddress?.id ?? null}
              initialAddress={serviceAddressDisplay}
            />
          ) : null}

          {readyForSmt && (
            <>
              <div className="space-y-4 rounded-3xl border-2 border-brand-navy bg-brand-navy/90 p-4 shadow-[0_18px_60px_rgba(16,46,90,0.18)] backdrop-blur max-[480px]:p-3 sm:p-6 md:p-7">
                <div className="rounded-2xl border-2 border-brand-blue bg-brand-navy p-4 text-sm text-brand-cyan shadow-[0_10px_30px_rgba(16,182,231,0.18)] sm:p-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-1">
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-cyan">
                        Service address on file
                      </h2>
                      <div className="space-y-0.5 text-brand-cyan/90">
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
                      <div className="space-y-0.5 text-brand-cyan/90">
                        <div>
                          <span className="font-semibold">Contact Email · </span>
                          {userEmail || "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                  {existingAuth && (
                  <div className="mt-4 rounded-lg border border-brand-cyan/45 bg-brand-navy p-3 text-xs leading-relaxed text-brand-cyan/80">
                      We already have a valid Smart Meter Texas authorization for this address. Submit the form again if you need to refresh your consent (for example after changing providers or revoking access in SMT).
                    </div>
                  )}
                </div>

                {existingAuth && (
                  <div className="rounded-2xl border-2 border-brand-blue bg-brand-navy p-4 text-xs text-brand-cyan shadow-[0_10px_30px_rgba(16,182,231,0.18)] sm:p-5">
                    <div className="flex flex-wrap items-center justify-center gap-3 text-center md:justify-between md:text-left">
                      <span className="text-[0.7rem] font-semibold uppercase tracking-wide">
                        SMT authorization last submitted{" "}
                        <LocalTime
                          value={existingAuth.createdAt.toISOString()}
                          fallback=""
                          options={{
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }}
                        />
                      </span>
                      {statusLabel ? (
                        <span className={statusBadgeStyles[statusTone]}>{statusLabel}</span>
                      ) : null}
                    </div>
                    {statusMessage ? (
                      <p className="mt-2 text-xs leading-relaxed text-brand-cyan/90 text-left">{statusMessage}</p>
                    ) : null}
                    {statusSecondaryMessage ? (
                      <p className="mt-1 text-xs leading-relaxed text-brand-cyan/80 text-left">{statusSecondaryMessage}</p>
                    ) : null}
                    {existingAuth?.authorizationEndDate ? (
                      <p className="mt-3 text-xs text-brand-cyan/70 text-left">
                        Authorization expires{" "}
                        <LocalTime
                          value={existingAuth.authorizationEndDate.toISOString()}
                          fallback=""
                          options={{
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }}
                        />
                      </p>
                    ) : null}
                  </div>
                )}

                <div className="rounded-2xl border border-brand-blue/10 bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] sm:p-6">
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

              <SmtManualFallbackCard houseAddressId={houseAddress?.id ?? null} />
            </>
          )}

          <div className="rounded-3xl border-2 border-brand-navy bg-white shadow-[0_24px_70px_rgba(16,46,90,0.08)]">
            <div className="flex flex-col gap-6 p-8 text-center sm:p-10">
              <div className="flex flex-col gap-3">
                <h2 className="text-2xl font-semibold tracking-tight text-brand-navy">Smart Home Devices</h2>
                <p className="mx-auto max-w-3xl text-sm leading-relaxed text-brand-slate">
                  Connect your Emporia Vue, Sense, Nest, Tesla, or Enphase devices to unlock richer insights and earn bonus jackpot entries. Device integrations are rolling out soon—get on the early access list so you’re first in line.
                </p>
              </div>

              <div className="flex flex-col gap-4 rounded-2xl border border-brand-cyan/40 bg-brand-navy px-6 py-6 text-center text-brand-cyan shadow-[0_12px_32px_rgba(16,46,90,0.12)] sm:flex-row sm:items-center sm:justify-between">
                <div className="mx-auto sm:mx-0">
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-cyan">
                    Coming Soon
                  </p>
                  <p className="mt-2 text-base font-medium text-brand-cyan">
                    Automatic OAuth logins and synced device APIs are on the way.
                  </p>
                </div>
                <div className="flex justify-center sm:justify-end">
                  <span className="inline-flex items-center gap-2 rounded-full bg-brand-navy px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan shadow-[0_10px_30px_rgba(16,46,90,0.08)]">
                    Preview Access
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
} 