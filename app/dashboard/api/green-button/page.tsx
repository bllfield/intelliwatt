import Link from "next/link";
import { redirect } from "next/navigation";
import { loadUsageEntryContext } from "../context";
import { deriveGreenButtonStatus, statusBadgeStyles } from "../statusHelpers";
import DashboardHero from "@/components/dashboard/DashboardHero";
import SmtAddressCaptureCard from "@/components/smt/SmtAddressCaptureCard";
import GreenButtonHelpSection from "@/components/dashboard/GreenButtonUtilitiesCard";
import LocalTime from "@/components/LocalTime";

// User-specific (cookies) so dynamic, but allow router to cache for back/forward.

export default async function UsageEntryGreenButtonPage() {
  const context = await loadUsageEntryContext();
  const { user, houseAddress } = context;

  if (context.loadError) {
    return (
      <div className="min-h-screen bg-brand-white">
        <DashboardHero
          title="Usage Entry"
          highlight="Green Button"
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
    redirect("/login?redirect=/dashboard/api/green-button");
  }

  if (!houseAddress) {
    return (
      <div className="min-h-screen bg-brand-white">
        <DashboardHero
          title="Usage Entry"
          highlight="Green Button"
          description="Add your service address and we’ll guide you through uploading the utility data file. Once the address is saved, you can upload Green Button XML/CSV exports anytime."
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

  const status = deriveGreenButtonStatus(context.greenButtonUpload);

  return (
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        title="Usage Entry"
        highlight="Green Button Upload"
        description="Download your usage directly from the utility portal and upload it here. IntelliWatt will normalize the file into 15-minute intervals so your insights stay fresh."
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
                  Green Button status
                </p>
                {context.greenButtonUpload?.createdAt ? (
                  <p className="text-xs text-brand-cyan/70">
                    Last upload{" "}
                    <LocalTime
                      value={context.greenButtonUpload.createdAt.toISOString()}
                      options={{ month: "short", day: "numeric", year: "numeric" }}
                      fallback="—"
                    />
                  </p>
                ) : null}
              </div>
              <span className={statusBadgeStyles[status.tone]}>{status.label}</span>
            </div>
            {status.message ? (
              <p className="mt-3 text-sm text-brand-cyan/80">{status.message}</p>
            ) : null}
            {status.detail ? (
              <p className="mt-2 text-xs text-brand-cyan/60">{status.detail}</p>
            ) : null}
          </div>

          <GreenButtonHelpSection
            houseAddressId={houseAddress.id}
            defaultUtilityName={houseAddress.utilityName ?? null}
          />
        </div>
      </section>
    </div>
  );
}

