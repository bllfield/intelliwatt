import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { SmtConfirmationActions } from "@/components/smt/SmtConfirmationActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeStatus(status: string | null | undefined): string {
  if (!status) return "";
  return status.toLowerCase();
}

export default async function SmtConfirmationPage() {
  const cookieStore = cookies();
  const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;

  if (!sessionEmail) {
    redirect("/join");
  }

  const normalizedEmail = normalizeEmail(sessionEmail);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, email: true },
  });

  if (!user) {
    redirect("/join");
  }

  const house = await prisma.houseAddress.findFirst({
    where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressState: true,
      addressZip5: true,
      esiid: true,
      utilityName: true,
    },
  });

  if (!house) {
    redirect("/dashboard/api");
  }

  const authorization = await prisma.smtAuthorization.findFirst({
    where: {
      userId: user.id,
      houseAddressId: house.id,
      archivedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      smtStatus: true,
      smtStatusMessage: true,
      createdAt: true,
      authorizationStartDate: true,
      authorizationEndDate: true,
    },
  });

  const status = normalizeStatus(authorization?.smtStatus);
  const isPending = status === "pending" || status === "";
  const isDeclined = status === "declined";
  const shouldRequireConfirmation = authorization && (isPending || isDeclined);

  if (!shouldRequireConfirmation) {
    redirect("/dashboard/api");
  }

  const statusMessage =
    authorization?.smtStatusMessage && authorization.smtStatusMessage.trim().length > 0
      ? authorization.smtStatusMessage
      : isDeclined
      ? "Smart Meter Texas shows the email was declined. We cannot sync usage until it is approved."
      : "We’re waiting on the Smart Meter Texas email confirmation. Approve it to enable IntelliWatt features.";

  return (
    <div className="flex min-h-[80vh] items-center justify-center bg-brand-navy px-4 py-12 text-brand-cyan">
      <div className="w-full max-w-3xl space-y-8 rounded-3xl border border-brand-cyan/30 bg-brand-navy/80 p-8 shadow-[0_24px_80px_rgba(16,46,90,0.6)]">
        <header className="space-y-3 text-center">
          <h1 className="text-3xl font-bold uppercase tracking-[0.3em] text-brand-cyan/70">
            Smart Meter Texas Confirmation
          </h1>
          <p className="text-sm leading-relaxed text-brand-cyan/80">
            We emailed{" "}
            <span className="font-semibold text-brand-cyan">{user.email}</span> a Smart Meter
            Texas authorization request. Approve it to unlock IntelliWatt features.
          </p>
        </header>

        <section className="space-y-4 rounded-2xl border border-brand-cyan/40 bg-brand-navy p-6 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
            Status
          </h2>
          <p className="text-brand-cyan">{statusMessage}</p>
          <p className="text-xs text-brand-cyan/70">
            If you do not see the email, check your spam folder. The sender is{" "}
            <span className="font-semibold text-brand-cyan">info@communications.smartmetertexas.com</span>.
          </p>
        </section>

        <section className="space-y-3 rounded-2xl border border-brand-cyan/30 bg-brand-navy p-6 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
            Service Address
          </h2>
          <div className="text-brand-cyan">
            <div>{house.addressLine1}</div>
            {house.addressLine2 ? <div>{house.addressLine2}</div> : null}
            <div>
              {[house.addressCity, house.addressState, house.addressZip5]
                .filter(Boolean)
                .join(", ")}
            </div>
            <div className="mt-2 text-xs text-brand-cyan/70">
              ESIID: <span className="font-mono text-brand-cyan">{house.esiid ?? "—"}</span>
            </div>
            <div className="text-xs text-brand-cyan/70">
              Utility: {house.utilityName ?? "Unknown utility"}
            </div>
          </div>
        </section>

        <SmtConfirmationActions homeId={house.id} />

        <footer className="space-y-2 rounded-2xl border border-brand-cyan/20 bg-brand-navy/70 p-4 text-xs text-brand-cyan/70">
          <p>
            Need help? Forward the SMT email to{" "}
            <span className="font-semibold text-brand-cyan">support@intelliwatt.com</span> or contact us if
            you did not request this authorization.
          </p>
          <p>
            Once approved, we’ll automatically refresh the status and return you to the dashboard.
          </p>
        </footer>
      </div>
    </div>
  );
}


