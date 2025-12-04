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

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

type OptionCardProps = {
  title: string;
  subtitle: string;
  description: string;
  href: string;
  status: EntryStatus;
  disabled: boolean;
  disabledMessage?: string;
  priority?: "primary" | "secondary";
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
}: OptionCardProps) {
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
              {status.message}
            </p>
          ) : null}
          {status.detail ? (
            <p className="mt-1 text-xs text-brand-cyan/60">{status.detail}</p>
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
              ? "border border-brand-cyan bg-brand-cyan text-brand-navy hover:bg-brand-cyan/90"
              : "border border-brand-cyan/40 bg-brand-navy text-brand-cyan hover:border-brand-cyan/70 hover:bg-brand-navy/80"
          }`}
        >
          {priority === "primary" ? "Start connection" : "Open entry flow"}
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
  const smtStatus = deriveSmtStatus(existingAuthorization);
  const greenStatus = deriveGreenButtonStatus(context.greenButtonUpload);
  const manualStatus = deriveManualStatus(context.manualUsageUpload);

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
                <div className="flex min-w-[220px] flex-col gap-3">
                  <div className="rounded-2xl border border-brand-cyan/40 bg-brand-navy px-4 py-3 text-xs text-brand-cyan/80">
                    <p className="font-semibold text-brand-cyan">How the hub works</p>
                    <p className="mt-1 leading-relaxed">
                      Connect SMT first whenever possible. If your utility supports Green Button, upload a file next. Use the
                      manual placeholder when neither option is ready—we’ll keep your jackpot entries active.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-5">
                <SmtAddressCaptureCard
                  houseAddressId={houseAddress?.id ?? null}
                  initialAddress={serviceAddressDisplay}
                />
              </div>
            </div>
          ) : null}

          <div className="mt-1 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <OptionCard
              title="Smart Meter Texas"
              subtitle="Preferred"
              description="Securely link SMT so IntelliWatt auto-syncs 15-minute usage and billing history. Unlocks the full experience."
              href="/dashboard/api/smt"
              status={smtStatus}
              disabled={!user || !hasHouseAddress}
              disabledMessage={!user ? "Sign in to continue" : "Add your service address first"}
              priority="primary"
            />
            <OptionCard
              title="Green Button Upload"
              subtitle="Utility exports"
              description="Download your usage as a Green Button XML/CSV file and upload it here. Ideal if SMT isn’t available yet."
              href="/dashboard/api/green-button"
              status={greenStatus}
              disabled={!user || !hasHouseAddress}
              disabledMessage={!user ? "Sign in to continue" : "Save your service address first"}
            />
            <OptionCard
              title="Manual Usage Placeholder"
              subtitle="Quick fallback"
              description="Log a manual placeholder reading so jackpot entries stay active while you wait for live data."
              href="/dashboard/api/manual"
              status={manualStatus}
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