import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";

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

function displayValue(value?: string | null, fallback = "Not provided") {
  if (!value) return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export default async function ProfilePage() {
  const cookieStore = cookies();
  const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;

  const prismaAny = prisma as any;

  if (!sessionEmail) {
    return (
      <div className="min-h-[60vh] bg-brand-white py-16 px-4">
        <div className="mx-auto max-w-lg rounded-2xl border border-brand-navy bg-white p-8 text-center shadow-lg">
          <h1 className="text-3xl font-bold text-brand-navy mb-4">Profile</h1>
          <p className="text-brand-navy/80">
            Sign in to view and update your IntelliWatt profile.
          </p>
        </div>
      </div>
    );
  }

  const normalizedEmail = normalizeEmail(sessionEmail);
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
          addressLine1: true,
          addressCity: true,
          addressState: true,
          addressZip: true,
        },
      },
    },
  });

  if (!user) {
    return (
      <div className="min-h-[60vh] bg-brand-white py-16 px-4">
        <div className="mx-auto max-w-lg rounded-2xl border border-brand-navy bg-white p-8 text-center shadow-lg">
          <h1 className="text-3xl font-bold text-brand-navy mb-4">Profile</h1>
          <p className="text-brand-navy/80">
            We couldn’t find your account details. Try signing out and back in, or contact support if
            the issue persists.
          </p>
        </div>
      </div>
    );
  }

  const houseAddress = await prismaAny.houseAddress.findFirst({
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

  const latestAuthorization = await prismaAny.smtAuthorization.findFirst({
    where: houseAddress
      ? { userId: user.id, houseAddressId: houseAddress.id }
      : { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      smtStatus: true,
      smtStatusMessage: true,
      meterNumber: true,
      authorizationStartDate: true,
      authorizationEndDate: true,
      customerName: true,
      contactPhone: true,
    },
  });

  const contactName =
    user.profile?.fullName ?? latestAuthorization?.customerName ?? null;
  const contactPhone =
    user.profile?.phone ?? latestAuthorization?.contactPhone ?? null;

  const addressLine1 =
    user.profile?.addressLine1 ?? houseAddress?.addressLine1 ?? null;
  const addressLine2 = houseAddress?.addressLine2 ?? null;
  const addressCity =
    user.profile?.addressCity ?? houseAddress?.addressCity ?? null;
  const addressState =
    user.profile?.addressState ?? houseAddress?.addressState ?? null;
  const addressZip =
    user.profile?.addressZip ?? houseAddress?.addressZip5 ?? null;

  const formattedAddress = [
    displayValue(addressLine1, ""),
    displayValue(addressLine2, ""),
    [displayValue(addressCity, ""), displayValue(addressState, ""), displayValue(addressZip, "")]
      .filter((part) => part !== "")
      .join(" "),
  ]
    .filter((part) => part !== "")
    .join("\n");

  const smtStatusRaw = latestAuthorization?.smtStatus?.toLowerCase() ?? null;
  const smtStatus =
    smtStatusRaw === "active"
      ? "Connected"
      : smtStatusRaw === "already_active"
      ? "Already Active"
      : smtStatusRaw === "pending"
      ? "Pending"
      : smtStatusRaw === "error"
      ? "Error"
      : latestAuthorization?.smtStatus ?? null;
  const smtExpiration = formatDate(latestAuthorization?.authorizationEndDate ?? null);
  const smtActivated = formatDate(latestAuthorization?.authorizationStartDate ?? null);

  return (
    <div className="min-h-[60vh] bg-brand-white py-12 px-4">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="rounded-3xl border border-brand-blue/15 bg-white px-6 py-10 text-center shadow-[0_24px_70px_rgba(16,46,90,0.06)] sm:px-10">
          <h1 className="text-3xl font-bold text-brand-navy mb-3">Profile</h1>
          <p className="text-sm text-brand-slate max-w-2xl mx-auto">
            Review the information we have on file. We’ll add editing tools and notification preferences
            here soon, so you can keep IntelliWatt in sync with your household details.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-brand-navy/15 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-brand-navy mb-4">Account</h2>
            <dl className="space-y-3 text-sm text-brand-navy">
              <div className="flex justify-between gap-4">
                <dt className="font-medium text-brand-slate">Email</dt>
                <dd className="font-semibold text-brand-navy">{user.email}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-medium text-brand-slate">Member since</dt>
                <dd>{formatDate(user.createdAt) ?? "—"}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-brand-navy/15 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-brand-navy mb-4">Contact</h2>
            <dl className="space-y-3 text-sm text-brand-navy">
              <div className="flex justify-between gap-4">
                <dt className="font-medium text-brand-slate">Name</dt>
                <dd>{displayValue(contactName)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="font-medium text-brand-slate">Phone</dt>
                <dd>{displayValue(contactPhone)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-brand-navy/15 bg-white p-6 shadow-sm md:col-span-2">
            <h2 className="text-lg font-semibold text-brand-navy mb-4">Service address</h2>
            {formattedAddress ? (
              <pre className="whitespace-pre-line text-sm text-brand-navy">{formattedAddress}</pre>
            ) : (
              <p className="text-sm text-brand-slate">No address on file yet.</p>
            )}
            <dl className="mt-4 grid gap-4 sm:grid-cols-2 text-sm text-brand-navy">
              <div>
                <dt className="font-medium text-brand-slate">ESIID</dt>
                <dd>{displayValue(houseAddress?.esiid)}</dd>
              </div>
              <div>
                <dt className="font-medium text-brand-slate">Utility</dt>
                <dd>{displayValue(houseAddress?.utilityName)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-brand-cyan/40 bg-brand-navy p-6 text-brand-cyan shadow-[0_18px_40px_rgba(16,182,231,0.2)] md:col-span-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Smart Meter Texas authorization</h2>
                {latestAuthorization ? (
                  <p className="text-xs text-brand-cyan/70 mt-1">
                    Authorization created {formatDate(latestAuthorization.createdAt) ?? "—"}
                  </p>
                ) : null}
              </div>
              {smtStatus ? (
                <span className="inline-flex items-center rounded-full bg-brand-cyan/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-cyan">
                  {smtStatus}
                </span>
              ) : null}
            </div>
            {latestAuthorization ? (
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-brand-cyan/80">Meter</dt>
                  <dd>{displayValue(latestAuthorization.meterNumber, "Not available")}</dd>
                </div>
                <div>
                  <dt className="font-medium text-brand-cyan/80">SMT status message</dt>
                  <dd>
                    {displayValue(
                      latestAuthorization.smtStatusMessage,
                      "No additional status reported"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-brand-cyan/80">Authorization started</dt>
                  <dd>{smtActivated ?? "Not available"}</dd>
                </div>
                <div>
                  <dt className="font-medium text-brand-cyan/80">Authorization expires</dt>
                  <dd>{smtExpiration ?? "Not available"}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 text-sm text-brand-cyan/80">
                You haven’t authorized Smart Meter Texas access yet. Head to the API Connect page to get
                started.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-brand-navy/15 bg-white p-6 text-center shadow-sm md:col-span-2">
            <h2 className="text-lg font-semibold text-brand-navy mb-2">
              Revoke Smart Meter access
            </h2>
            <p className="text-sm text-brand-slate mb-4">
              We’re wrapping up the self-service revoke flow. In the meantime, contact support if you
              need to remove IntelliWatt’s access to Smart Meter Texas data.
            </p>
            <span className="inline-flex items-center rounded-full bg-brand-navy px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan">
              Under construction
            </span>
          </section>
        </div>
      </div>
    </div>
  );
}
