import Link from "next/link";
import { redirect } from "next/navigation";
import { loadUsageEntryContext } from "../context";
import { deriveManualStatus, statusBadgeStyles } from "../statusHelpers";
import DashboardHero from "@/components/dashboard/DashboardHero";
import SmtAddressCaptureCard from "@/components/smt/SmtAddressCaptureCard";
import SmtManualFallbackCard from "@/components/smt/SmtManualFallbackCard";
import LocalTime from "@/components/LocalTime";

// User-specific (cookies) so dynamic, but allow router to cache for back/forward.

export default async function UsageEntryManualPage() {
  const context = await loadUsageEntryContext();
  const { user, houseAddress } = context;

  if (context.loadError) {
    return (
      <div className="min-h-screen bg-brand-white">
        <DashboardHero
          title="Usage Entry"
          highlight="Manual Placeholder"
          description="We’re having trouble loading your dashboard right now. Please wait a moment and refresh."
        />
        <section className="bg-brand-white px-4 pb-12 pt-4">
          <div className="mx-auto w-full max-w-4xl space-y-4">
            <div className="rounded-2xl border border-amber-200/70 bg-amber-100/40 px-5 py-4 text-sm font-medium text-amber-800">
              Temporarily unavailable: {context.loadError}
            </div>
            <Link href="/dashboard/api" className="inline-flex items-center text-sm font-semibold text-brand-blue underline-offset-4 hover:underline">
              ← Back to Usage Entry hub
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (!user) {
    redirect("/login?redirect=/dashboard/api/manual");
  }

  if (!houseAddress) {
    return (
      <div className="min-h-screen bg-brand-white">
        <DashboardHero
          title="Usage Entry"
          highlight="Manual Placeholder"
          description="Add the service address you want IntelliWatt to analyze. Once it’s on file, you can record a temporary usage placeholder while SMT or Green Button data is pending."
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

  const manualStatus = deriveManualStatus(context.manualUsageUpload);

  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Usage Entry"
        highlight="Manual Placeholder"
        description="Need to keep your jackpot entries active while SMT access is pending? Record a quick manual placeholder. You can replace it with live usage as soon as SMT or a Green Button file is ready."
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                  Manual placeholder status
                </p>
                {context.manualUsageUpload?.uploadedAt ? (
                  <p className="text-xs text-brand-cyan/70">
                    Last recorded{" "}
                    <LocalTime
                      value={context.manualUsageUpload.uploadedAt.toISOString()}
                      options={{ month: "short", day: "numeric", year: "numeric" }}
                      fallback="—"
                    />
                  </p>
                ) : null}
              </div>
              <span className={statusBadgeStyles[manualStatus.tone]}>
                {manualStatus.label}
              </span>
            </div>
            {manualStatus.message ? (
              <p className="mt-3 text-sm text-brand-cyan/80">{manualStatus.message}</p>
            ) : null}
            {manualStatus.detail ? (
              <p className="mt-2 text-xs text-brand-cyan/60">{manualStatus.detail}</p>
            ) : null}
          </div>

          <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
              How it works
            </p>
            <p className="mt-2 text-sm leading-relaxed text-brand-cyan/85">
              We’ll log a one-time usage placeholder so your jackpot entries stay active while SMT access is pending. As soon
              as you connect SMT or upload a Green Button file, this placeholder is replaced automatically.
            </p>
            <p className="mt-2 text-xs text-brand-cyan/60">
              Need another option? You can always{" "}
              <Link href="/dashboard/api/smt" className="text-brand-cyan underline-offset-2 hover:underline">
                connect Smart Meter Texas
              </Link>{" "}
              or{" "}
              <Link href="/dashboard/api/green-button" className="text-brand-cyan underline-offset-2 hover:underline">
                upload a Green Button file
              </Link>{" "}
              whenever they’re available.
            </p>
          </div>

          <SmtManualFallbackCard houseAddressId={houseAddress.id} />
        </div>
      </section>
    </div>
  );
}

