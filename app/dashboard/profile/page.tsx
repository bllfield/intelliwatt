import { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { ProfileContactForm } from "@/components/profile/ProfileContactForm";
import { ProfileAddressSection } from "@/components/profile/ProfileAddressSection";
import { ProfileTestimonialCard } from "@/components/profile/ProfileTestimonialCard";
import { RevokeSmartMeterButton } from "@/components/profile/RevokeSmartMeterButton";
import DashboardHero from "@/components/dashboard/DashboardHero";
const COMMISSION_STATUS_ALLOWLIST = ["pending", "submitted", "approved", "completed", "paid"];

function isTestimonialTableMissing(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2021" &&
    /TestimonialSubmission/i.test(error.message)
  );
}


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

type DbHouseRecord = {
  id: string;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip5: string | null;
  esiid: string | null;
  utilityName: string | null;
  isPrimary: boolean;
  archivedAt: Date | null;
  label: string | null;
  smtAuthorizations: Array<{ id: string }>;
};

type EntryRow = {
  id: string;
  type: string;
  amount: number;
  houseId: string | null;
};

type HouseSummary = {
  id: string;
  label: string | null;
  formattedAddress: string;
  hasSmt: boolean;
  entries: number;
  esiid: string | null;
  utilityName: string | null;
  isPrimary: boolean;
};

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
            We couldn’t find your account details. Try signing out and back in, or contact support if the issue persists.
          </p>
        </div>
      </div>
    );
  }

  const housesRaw = (await prismaAny.houseAddress.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressState: true,
      addressZip5: true,
      esiid: true,
      utilityName: true,
      isPrimary: true,
      archivedAt: true,
      label: true,
      smtAuthorizations: {
        where: { archivedAt: null },
        select: { id: true },
      },
    },
  })) as DbHouseRecord[];

  const entries = (await prismaAny.entry.findMany({
    where: { userId: user.id },
    select: { id: true, type: true, amount: true, houseId: true },
  })) as EntryRow[];

  const entriesByHouse = new Map<string, number>();
  for (const entry of entries) {
    const bucket = entry.houseId ?? "global";
    entriesByHouse.set(bucket, (entriesByHouse.get(bucket) ?? 0) + entry.amount);
  }
  const cumulativeEntries = entries.reduce((sum, entry) => sum + entry.amount, 0);

  const activeHouses = housesRaw.filter((house) => house.archivedAt === null);

  const houseSummaries: HouseSummary[] = activeHouses.map((house) => {
    const formatted = formatAddress([
      house.addressLine1,
      house.addressLine2,
      `${house.addressCity ?? ""}, ${house.addressState ?? ""} ${house.addressZip5 ?? ""}`,
    ]);
    const hasSmt = (house.smtAuthorizations?.length ?? 0) > 0;
    return {
      id: house.id,
      label: house.label,
      formattedAddress: formatted,
      hasSmt,
      entries: entriesByHouse.get(house.id) ?? 0,
      esiid: house.esiid,
      utilityName: house.utilityName,
      isPrimary: Boolean(house.isPrimary),
    };
  });

  const activeHouseSummary =
    houseSummaries.find((house) => house.isPrimary) ?? houseSummaries[0] ?? null;

  const activeHouseDetails = activeHouseSummary
    ? {
        id: activeHouseSummary.id,
        formattedAddress: activeHouseSummary.formattedAddress,
        esiid: activeHouseSummary.esiid,
        utilityName: activeHouseSummary.utilityName,
      }
    : null;

  const allowAdd =
    houseSummaries.length === 0 || houseSummaries.every((house) => house.hasSmt === true);

  const smtAuthorization = activeHouseSummary
    ? await prismaAny.smtAuthorization.findFirst({
        where: {
          userId: user.id,
          houseAddressId: activeHouseSummary.id,
          archivedAt: null,
        } as any,
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
      })
    : null;

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

  const addressSectionHouses = houseSummaries.map((house) => ({
    id: house.id,
    label: house.label,
    formattedAddress: house.formattedAddress,
    hasSmt: house.hasSmt,
    entries: house.entries,
  }));

  const [currentPlan, qualifyingCommission] = await Promise.all([
    prismaAny.utilityPlan.findFirst({
      where: { userId: user.id, isCurrent: true },
      select: { id: true },
    }),
    prismaAny.commissionRecord.findFirst({
      where: {
        userId: user.id,
        status: { in: COMMISSION_STATUS_ALLOWLIST },
        OR: [
          { type: { contains: "switch", mode: "insensitive" } },
          { type: { contains: "plan", mode: "insensitive" } },
          { type: { contains: "upgrade", mode: "insensitive" } },
        ],
      },
      select: { id: true },
    }),
  ]);

  let testimonialSubmission: {
    status: string;
    content: string;
    submittedAt: Date;
    entryAwardedAt: Date | null;
  } | null = null;

  try {
    testimonialSubmission = await prismaAny.testimonialSubmission.findFirst({
      where: { userId: user.id },
      orderBy: { submittedAt: "desc" },
      select: {
        status: true,
        content: true,
        submittedAt: true,
        entryAwardedAt: true,
      },
    });
  } catch (error) {
    if (!isTestimonialTableMissing(error)) {
      throw error;
    }
    if (process.env.NODE_ENV !== "production") {
      console.warn("[profile] Skipping testimonial lookup; table missing.");
    }
  }

  const testimonialEligible = Boolean(currentPlan) || Boolean(qualifyingCommission);
  const testimonialSummary = testimonialSubmission
    ? {
        status: testimonialSubmission.status as "PENDING" | "APPROVED" | "REJECTED",
        content: testimonialSubmission.content,
        submittedAt: testimonialSubmission.submittedAt.toISOString(),
        entryAwardedAt: testimonialSubmission.entryAwardedAt
          ? testimonialSubmission.entryAwardedAt.toISOString()
          : null,
      }
    : null;

  return (
    <div className="min-h-screen bg-white py-12 px-4 text-brand-navy">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <DashboardHero
          title="Profile"
          highlight="& Home"
          description="Manage your IntelliWatt contact preferences, connect additional homes, and keep Smart Meter Texas authorizations current. Each home earns its own entries once SMT is connected."
          eyebrow="Account Center"
        />

        <div className="grid gap-6 lg:grid-cols-[1fr,1fr]">
          <section className="rounded-3xl border border-brand-cyan/30 bg-brand-navy p-6 text-brand-cyan shadow-[0_0_35px_rgba(56,189,248,0.28)]">
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
            activeHouse={activeHouseDetails}
            houses={addressSectionHouses}
            allowAdd={allowAdd}
            cumulativeEntries={cumulativeEntries}
          />
        </div>

        <ProfileTestimonialCard eligible={testimonialEligible} submission={testimonialSummary} />

        <section className="rounded-3xl border border-brand-cyan/40 bg-brand-navy p-6 text-brand-cyan shadow-[0_0_35px_rgba(56,189,248,0.28)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
                Smart Meter Texas
              </h2>
              <p className="mt-2 text-sm text-brand-cyan/80">
                Monitor the status of your live SMT agreement. Reauthorize anytime if you change Retail Electric Providers or move to a new address.
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
              You haven’t authorized Smart Meter Texas access yet for this home. Head to the API connect page to get started.
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-brand-cyan/30 bg-brand-navy p-6 text-brand-cyan shadow-[0_0_35px_rgba(56,189,248,0.28)]">
          <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
            Revoke SMT access
          </h2>
          <p className="mt-3 text-sm text-brand-cyan/80">
            Need to turn off Smart Meter Texas sharing? Submit the request below. We’ll archive your
            authorization immediately and email you once the disconnect is confirmed.
          </p>
          <RevokeSmartMeterButton authorizationId={smtAuthorization?.id ?? null} />
        </section>
      </div>
    </div>
  );
}
