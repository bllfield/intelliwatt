import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { SmtAuthorizationForm } from "@/components/smt/SmtAuthorizationForm";

export default async function ApiConnectPage() {
  const cookieStore = cookies();
  const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;

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

  let existingAuth: any | null = null;
  if (user && houseAddress) {
    existingAuth = await prisma.smtAuthorization.findFirst({
      where: { userId: user.id, houseAddressId: houseAddress.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    });
  }

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
    <div className="max-w-4xl mx-auto space-y-16">
      <section id="smt" className="py-10">
        <div className="space-y-6">
          <h1 className="text-2xl font-bold text-brand-navy">Smart Meter Texas (SMT)</h1>
          <p className="text-sm text-slate-600">
            Connect directly to your utility's smart meter so IntelliWatt can automatically pull your interval and billing data. We use this insight solely to optimize your plan recommendations.
          </p>

          {!user && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
              Please sign in to connect Smart Meter Texas.
            </div>
          )}

          {user && !houseAddress && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
              We don’t have a service address on file yet. Please complete your address and plan details first.
            </div>
          )}

          {user && houseAddress && !hasEsiid && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
              We have your address, but we couldn’t find an ESIID yet. Please complete the rate lookup step before connecting SMT.
            </div>
          )}

          {user && houseAddress && hasEsiid && !hasTdspOrUtility && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
              We found an ESIID, but utility information is still missing. Once the rate lookup fills in TDSP details, you’ll be able to authorize SMT.
            </div>
          )}

          {readyForSmt && (
            <div className="bg-white border-2 border-brand-navy rounded-2xl shadow-lg p-6 space-y-4">
              <div className="space-y-2 text-sm text-slate-700">
                <h2 className="text-lg font-semibold text-brand-navy">Service address on file</h2>
                <p>
                  {serviceAddressLine1}
                  {serviceAddressLine2 ? (
                    <>
                      <br />
                      {serviceAddressLine2}
                    </>
                  ) : null}
                  <br />
                  {serviceCity}, {serviceState} {serviceZip}
                  <br />
                  ESIID: {houseAddress.esiid}
                  <br />
                  Utility: {tdspName}
                </p>
                {existingAuth && (
                  <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-emerald-800">
                    An SMT authorization was last submitted on {existingAuth.createdAt.toLocaleDateString()}.
                  </div>
                )}
              </div>

              <SmtAuthorizationForm
                userId={user!.id}
                contactEmail={user!.email}
                houseAddressId={houseAddress.id}
                houseId={houseAddress.houseId ?? houseAddress.id}
                esiid={houseAddress.esiid!}
                tdspCode={tdspCode}
                tdspName={tdspName}
                serviceAddressLine1={serviceAddressLine1}
                serviceAddressLine2={serviceAddressLine2}
                serviceCity={serviceCity}
                serviceState={serviceState}
                serviceZip={serviceZip}
              />
            </div>
          )}
        </div>
      </section>

      <section className="py-10">
        <div className="bg-white p-8 rounded-2xl border border-brand-blue/20 shadow-lg space-y-6">
          <h2 className="text-xl font-semibold text-brand-navy">Smart Home Devices</h2>
          <p className="text-brand-slate text-sm">
            Connect your Emporia Vue, Sense, Nest, Tesla, or Enphase devices to unlock richer insights and earn bonus jackpot entries. Device integrations are rolling out soon.
          </p>
          <div className="bg-gradient-to-r from-brand-blue to-brand-cyan p-6 rounded-2xl text-center text-brand-navy">
            <h3 className="font-bold text-lg mb-2">Coming Soon</h3>
            <p>Automatic OAuth logins and synced device APIs are on the way.</p>
          </div>
        </div>
      </section>
    </div>
  );
} 