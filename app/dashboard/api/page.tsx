import type { ReactNode } from "react";
import Link from "next/link";
import { loadUsageEntryContext, UsageEntryContext } from "./context";
import {
  deriveGreenButtonStatus,
  deriveManualStatus,
  deriveSmtStatus,
  EntryStatus,
  statusBadgeStyles,
} from "./statusHelpers";
import SmtAddressCaptureCard from "@/components/smt/SmtAddressCaptureCard";
import DashboardHero from "@/components/dashboard/DashboardHero";
import LocalTime from "@/components/LocalTime";
import RefreshSmtButton from "@/components/smt/RefreshSmtButton";

// Note: this page is user-specific (reads cookies) so it will remain dynamic,
// but we avoid forcing re-render on every client navigation so Next can reuse
// the router cache when going back/forward.

function formatServiceAddress(house: UsageEntryContext["houseAddress"]) {
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

function highlightEntriesText(text: string): ReactNode {
  return text
    .split(/(entries?|entry)/gi)
    .filter((part) => part.length > 0)
    .map((part, index) =>
      /^(entry|entries)$/i.test(part) ? (
        <span key={`entry-${index}`} className="font-semibold text-[#39FF14]">
          {part}
        </span>
      ) : (
        <span key={`text-${index}`}>{part}</span>
      ),
    );
}

type OptionCardProps = {
  title: string;
  subtitle: string;
  description: ReactNode;
  href: string;
  status: EntryStatus;
  disabled: boolean;
  disabledMessage?: string;
  priority?: "primary" | "secondary";
  connectedCtaLabel?: string;
};

function OptionCard({
  title,
  subtitle,
  description,
  href,
  status,
  disabled,
  disabledMessage,
  priority = "secondary",
  connectedCtaLabel,
}: OptionCardProps) {
  const isConnected = status.tone === "success";
  const buttonLabel = isConnected
    ? connectedCtaLabel ?? (priority === "primary" ? "Update connection" : "Update entry")
    : priority === "primary"
    ? "Start connection"
    : "Open entry flow";

  return (
    <div className="flex h-full flex-col justify-between rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-5 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)] transition hover:shadow-[0_20px_60px_rgba(16,46,90,0.28)]">
      <div className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold uppercase tracking-[0.32em] text-brand-cyan/70">
            {subtitle}
          </h3>
          <p className="text-lg font-semibold text-brand-white">{title}</p>
        </div>
        <p className="text-sm leading-relaxed text-brand-cyan/85">{description}</p>
        <div className="rounded-2xl border border-brand-cyan/30 bg-brand-navy/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={statusBadgeStyles[status.tone]}>
              {status.label}
            </span>
            {status.lastUpdated ? (
              <span className="text-[0.65rem] uppercase tracking-[0.3em] text-brand-cyan/50">
                Updated{" "}
                <LocalTime
                  value={status.lastUpdated.toISOString()}
                  options={{ month: "short", day: "numeric" }}
                  fallback="—"
                />
              </span>
            ) : null}
          </div>
        {status.message ? (
          <p className="mt-2 text-xs leading-snug text-brand-cyan/75">
            {typeof status.message === "string" ? highlightEntriesText(status.message) : status.message}
          </p>
        ) : null}
        {status.detail ? (
          <p className="mt-1 text-xs text-brand-cyan/60">
            {typeof status.detail === "string" ? highlightEntriesText(status.detail) : status.detail}
          </p>
        ) : null}
          {status.expiresAt ? (
            <p className="mt-1 text-xs text-brand-cyan/60">
              Expires{" "}
              <LocalTime
                value={status.expiresAt.toISOString()}
                options={{ month: "short", day: "numeric", year: "numeric" }}
                fallback="—"
              />
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <Link
          href={disabled ? "#" : href}
          aria-disabled={disabled}
          className={`inline-flex items-center justify-center rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-wide shadow-[0_12px_40px_rgba(16,46,90,0.28)] transition ${
            disabled
              ? "cursor-not-allowed border border-brand-cyan/20 bg-brand-navy/40 text-brand-cyan/50"
              : priority === "primary"
              ? "border border-[#39FF14] bg-[#39FF14] text-brand-navy hover:bg-[#39FF14]/90"
              : "border border-[#39FF14]/50 bg-transparent text-[#39FF14] hover:border-[#39FF14] hover:bg-[#39FF14]/10"
          }`}
        >
          {buttonLabel}
        </Link>
        {disabled && disabledMessage ? (
          <p className="text-center text-[0.7rem] text-brand-cyan/60">
            {disabledMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default async function UsageEntryHub() {
  const context = await loadUsageEntryContext();
  const { user, houseAddress, existingAuthorization, displacedAttention } = context;

  const serviceAddressDisplay = formatServiceAddress(houseAddress);
  const smtStatus = deriveSmtStatus(existingAuthorization, context.smtLatestIntervalAt);
  const greenStatus = deriveGreenButtonStatus(context.greenButtonUpload);
  const manualStatus = deriveManualStatus(context.manualUsageUpload);
  const newBuildStatus: EntryStatus = {
    label: "Available",
    tone: "info",
    message: "No usage history? Estimate a baseline from your home, appliances, and occupancy details.",
  };

  const hasHouseAddress = Boolean(houseAddress);

  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Usage"
        highlight="Entry"
        description="Pick how you want to share usage data. Start with the service address on file, then connect Smart Meter Texas, upload a Green Button file, or log a manual placeholder so IntelliWatt can keep your rewards active."
      />

      <section className="bg-brand-white px-4 pb-12 pt-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          {context.loadError ? (
            <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
              We’re having trouble loading usage connections right now. Please refresh in a moment.
            </div>
          ) : null}
          {displacedAttention ? (
            <div className="rounded-2xl border border-rose-400/45 bg-rose-500/10 px-5 py-4 text-sm text-brand-navy shadow-[0_18px_45px_rgba(190,18,60,0.18)]">
              Another IntelliWatt household just connected this Smart Meter Texas meter. Update your service address below
              and reconnect to keep your entries active.
            </div>
          ) : null}

          {!user ? (
            <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-center text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
              Sign in to manage your usage connections.
            </div>
          ) : null}

          {user ? (
            <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
                    Service address
                  </h2>
                  {serviceAddressDisplay ? (
                    <div className="whitespace-pre-line text-sm leading-relaxed text-brand-cyan/90">
                      {serviceAddressDisplay}
                      {houseAddress?.esiid ? (
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
                <div className="flex min-w-[220px] flex-col items-start gap-2 text-left text-xs md:items-end md:text-right">
                  <span className={statusBadgeStyles[smtStatus.tone]}>{smtStatus.label}</span>
                  {smtStatus.lastUpdated ? (
                    <span className="text-brand-cyan/60">
                      Updated{" "}
                      <LocalTime
                        value={smtStatus.lastUpdated.toISOString()}
                        options={{ month: "short", day: "numeric", year: "numeric" }}
                        fallback="—"
                      />
                    </span>
                  ) : null}
                  {existingAuthorization?.authorizationEndDate ? (
                    <span className="text-brand-cyan/60">
                      Expires{" "}
                      <LocalTime
                        value={existingAuthorization.authorizationEndDate.toISOString()}
                        options={{ month: "short", day: "numeric", year: "numeric" }}
                        fallback="—"
                      />
                    </span>
                  ) : null}
                  {existingAuthorization && houseAddress?.id ? (
                    <div className="pt-1">
                      <RefreshSmtButton homeId={houseAddress.id} />
                    </div>
                  ) : null}
                </div>
              </div>

              {smtStatus.message ? (
                <p className="mt-3 text-sm text-brand-cyan/80">
                  {typeof smtStatus.message === "string"
                    ? highlightEntriesText(smtStatus.message)
                    : smtStatus.message}
                </p>
              ) : null}
              {smtStatus.tone !== "success" ? (
                <p className="mt-3 text-sm font-semibold text-brand-cyan">
                  Connect Smart Meter Texas now to earn{" "}
                  <span className="text-[#39FF14]">1 jackpot entry</span> instantly.
                </p>
              ) : null}

              <div className="mt-5">
                <SmtAddressCaptureCard
                  houseAddressId={houseAddress?.id ?? null}
                  initialAddress={serviceAddressDisplay}
                />
              </div>
            </div>
          ) : null}

          <div className="mt-1 grid gap-5 md:grid-cols-2">
            <OptionCard
              title="Smart Meter Texas"
              subtitle="Preferred"
              description={
                <span className="text-brand-cyan/85">
                  Securely link SMT so IntelliWatt auto-syncs 15-minute usage and billing history. Unlocks the full experience.
                  <span className="text-xs text-brand-cyan/70">
                    {" "}
                    (Available to all customers in deregulated Texas service areas.)
                  </span>
                </span>
              }
              href="/dashboard/api/smt"
              status={smtStatus}
              disabled={!user || !hasHouseAddress}
              disabledMessage={!user ? "Sign in to continue" : "Add your service address first"}
              priority="primary"
              connectedCtaLabel="Update connection"
            />
            <OptionCard
              title="Green Button Upload"
              subtitle="Utility exports"
              description={
                <span className="text-brand-cyan/85">
                  Download your usage as a Green Button XML/CSV file and upload it here. Ideal if SMT or an automatic data
                  pull isn’t available yet. This provides better accuracy but takes more work than an automatic feed through
                  SMT.
                </span>
              }
              href="/dashboard/api/green-button"
              status={greenStatus}
              disabled={!user || !hasHouseAddress}
              disabledMessage={!user ? "Sign in to continue" : "Save your service address first"}
            />
            <OptionCard
              title="Manual Usage"
              subtitle="Quick fallback"
              description={
                <span className="text-brand-cyan/85">
                  Log a manual reading for a jackpot entry if you do not have SMT or Green Button access. It is less accurate
                  and a bit more work, so please use SMT or Green Button when available for best results.
                </span>
              }
              href="/dashboard/api/manual"
              status={manualStatus}
              disabled={!user || !hasHouseAddress}
              disabledMessage={!user ? "Sign in to continue" : "Save your service address first"}
            />
            <OptionCard
              title="New Build / No usage history"
              subtitle="Estimator"
              description={
                <span className="text-brand-cyan/85">
                  If you don’t have 12 months of usage yet (or it’s a brand new home), start here. We’ll estimate a baseline
                  curve from your home, appliances, and occupancy details so you can still compare plans and scenarios.
                </span>
              }
              href="/dashboard/usage/simulated?intent=NEW_BUILD#start-here"
              status={newBuildStatus}
              disabled={!user || !hasHouseAddress}
              disabledMessage={!user ? "Sign in to continue" : "Save your service address first"}
            />
          </div>

          <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/80 px-6 py-6 text-sm text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
            <p className="font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
              Need to reconnect something?
            </p>
            <p className="mt-2 leading-relaxed text-brand-cyan/85">
              If SMT access expires or you change providers, revisit the Smart Meter Texas flow above. The same applies for
              Green Button uploads—drop in a fresh file anytime. We’ll refresh your jackpot entries automatically.
            </p>
          </div>

          <div className="rounded-3xl border border-brand-cyan/20 bg-brand-white px-6 py-6 text-sm text-brand-slate shadow-[0_24px_70px_rgba(16,46,90,0.08)]">
            <p className="font-semibold text-brand-navy">
              Looking for device integrations?
            </p>
            <p className="mt-1 leading-relaxed">
              Smart home device links (Emporia, Sense, Tesla, etc.) are moving into the Home Details workflow later in the
              project so the usage hub stays focused on data uploads. Stay tuned!
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}