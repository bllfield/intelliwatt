import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { ProfileContactForm } from "@/components/profile/ProfileContactForm";
import { ProfileAddressSection } from "@/components/profile/ProfileAddressSection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(date?: Date | null) {
  return date ? dateFormatter.format(date) : null;
}

function formatAddress(parts: Array<string | null | undefined>) {
  return parts
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .map((part) => part!.trim())
    .join("\n");
}

export default async function ProfilePage() {
  const cookieStore = cookies();
  const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;

  if (!sessionEmail) {
    return (
      <div className="min-h-[70vh] bg-brand-navy py-20 px-4">
        <div className="mx-auto max-w-xl rounded-3xl border border-brand-cyan/30 bg-brand-navy/70 p-10 text-center text-brand-cyan shadow-[0_24px_70px_rgba(16,46,90,0.5)]">
          <h1 className="text-3xl font-semibold uppercase tracking-wide text-brand-cyan">Profile</h1>
          <p className="mt-4 text-sm text-brand-cyan/70">
            Sign in to view and update your IntelliWatt profile.
          </p>
        </div>
      </div>
    );
  }

  const normalizedEmail = normalizeEmail(sessionEmail);
  const prismaAny = prisma as any;

  const user = await prismaAny.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      createdAt: true,
      profile: {
        select: {
          fullName: true,
          phone: true,
        },
      },
    },
  });

  if (!user) {
    return (
      <div className="min-h-[70vh] bg-brand-navy py-20 px-4">
        <div className="mx-auto max-w-xl rounded-3xl border border-brand-cyan/30 bg-brand-navy/70 p-10 text-center text-brand-cyan shadow-[0_24px_70px_rgba(16,46,90,0.5)]">
          <h1 className="text-3xl font-semibold uppercase tracking-wide text-brand-cyan">Profile</h1>
          <p className="mt-4 text-sm text-brand-cyan/70">
            We couldn’t find your account details. Try signing out and back in, or contact support if the
            issue persists.
          </p>
        </div>
      </div>
    );
  }

  let houseAddress = await prismaAny.houseAddress.findFirst({
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

  if (!houseAddress) {
    houseAddress = await prismaAny.houseAddress.findFirst({
      where: { userId: user.id },
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
  }

  const smtAuthorization = await prismaAny.smtAuthorization.findFirst({
    where: houseAddress
      ? ({ userId: user.id, houseAddressId: houseAddress.id, archivedAt: null } as any)
      : ({ userId: user.id, archivedAt: null } as any),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      smtStatus: true,
      smtStatusMessage: true,
      meterNumber: true,
      authorizationStartDate: true,
      authorizationEndDate: true,
    },
  });

  const formattedAddress = houseAddress
    ? formatAddress([
        houseAddress.addressLine1,
        houseAddress.addressLine2,
        `${houseAddress.addressCity ?? ""}, ${houseAddress.addressState ?? ""} ${
          houseAddress.addressZip5 ?? ""
        }`,
      ])
    : "";

  const smtStatusRaw = smtAuthorization?.smtStatus?.toLowerCase() ?? null;
  const smtStatus =
    smtStatusRaw === "active"
      ? "Connected"
      : smtStatusRaw === "already_active"
      ? "Already Active"
      : smtStatusRaw === "pending"
      ? "Pending"
      : smtStatusRaw === "error"
      ? "Error"
      : smtAuthorization?.smtStatus ?? null;

  return (
    <div className="min-h-screen bg-brand-navy py-12 px-4 text-brand-cyan">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="rounded-3xl border border-brand-cyan/30 bg-brand-navy/70 p-8 text-center shadow-[0_28px_80px_rgba(16,46,90,0.55)]">
          <p className="text-[11px] uppercase tracking-[0.4em] text-brand-cyan/60">Account Center</p>
          <h1 className="mt-3 text-4xl font-semibold uppercase tracking-wide text-brand-cyan">
            Profile & Home
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-brand-cyan/70">
            Keep your IntelliWatt contact details and service address current. Updating your address
            immediately archives your previous Smart Meter Texas agreement so you can authorize the new
            home.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr,1fr]">
          <section className="rounded-3xl border border-brand-cyan/30 bg-brand-navy/80 p-6 shadow-[0_24px_70px_rgba(16,46,90,0.5)]">
            <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
              Contact details
            </h2>
            <div className="mt-4 space-y-6">
              <ProfileContactForm
                initialEmail={user.email}
                initialPhone={user.profile?.phone ?? ""}
                initialName={user.profile?.fullName ?? ""}
              />
              <dl className="rounded-2xl border border-brand-cyan/30 bg-brand-navy/60 p-4 text-sm text-brand-cyan">
                <div className="flex justify-between gap-4">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-brand-cyan/70">
                    Member since
                  </dt>
                  <dd>{formatDate(user.createdAt) ?? "—"}</dd>
                </div>
              </dl>
            </div>
          </section>

          <ProfileAddressSection
            formattedAddress={formattedAddress}
            esiid={houseAddress?.esiid ?? null}
            utilityName={houseAddress?.utilityName ?? null}
          />
        </div>

        <section className="rounded-3xl border border-brand-cyan/40 bg-brand-navy/80 p-6 shadow-[0_28px_80px_rgba(16,46,90,0.55)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
                Smart Meter Texas
              </h2>
              <p className="mt-2 text-sm text-brand-cyan/80">
                Monitor the status of your live SMT agreement. Reauthorize anytime if you change Retail
                Electric Providers or move to a new address.
              </p>
            </div>
            {smtStatus ? (
              <span className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-brand-cyan">
                {smtStatus}
              </span>
            ) : null}
          </div>

          {smtAuthorization ? (
            <dl className="mt-6 grid gap-4 text-sm text-brand-cyan sm:grid-cols-2">
              <div className="rounded-2xl border border-brand-cyan/30 bg-brand-navy/60 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-brand-cyan/70">
                  Meter number
                </dt>
                <dd className="mt-2 text-sm text-brand-cyan/90">
                  {smtAuthorization.meterNumber ?? "Not available"}
                </dd>
              </div>
              <div className="rounded-2xl border border-brand-cyan/30 bg-brand-navy/60 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-brand-cyan/70">
                  Authorized on
                </dt>
                <dd className="mt-2 text-sm text-brand-cyan/90">
                  {formatDate(smtAuthorization.authorizationStartDate) ?? "—"}
                </dd>
              </div>
              <div className="rounded-2xl border border-brand-cyan/30 bg-brand-navy/60 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-brand-cyan/70">
                  Expires
                </dt>
                <dd className="mt-2 text-sm text-brand-cyan/90">
                  {formatDate(smtAuthorization.authorizationEndDate) ?? "Not available"}
                </dd>
              </div>
              <div className="rounded-2xl border border-brand-cyan/30 bg-brand-navy/60 p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-brand-cyan/70">
                  SMT message
                </dt>
                <dd className="mt-2 text-sm text-brand-cyan/80">
                  {smtAuthorization.smtStatusMessage?.trim().length
                    ? smtAuthorization.smtStatusMessage
                    : "No additional status reported."}
                </dd>
              </div>
            </dl>
          ) : (
            <div className="mt-6 rounded-2xl border border-brand-blue/40 bg-brand-blue/10 p-4 text-sm text-brand-blue">
              You haven’t authorized Smart Meter Texas access yet. Head to the API connect page to get
              started.
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-brand-cyan/30 bg-brand-navy/80 p-6 text-center shadow-[0_24px_70px_rgba(16,46,90,0.5)]">
          <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
            Revoke SMT access
          </h2>
          <p className="mt-3 text-sm text-brand-cyan/80">
            We’re wrapping up the self-service revoke flow. In the meantime, contact support if you need
            to remove IntelliWatt’s SMT access.
          </p>
          <span className="mt-4 inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-brand-cyan">
            Under construction
          </span>
        </section>
      </div>
    </div>
  );
}
