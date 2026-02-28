import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import IdleGuard from '@/components/IdleGuard';
import EntriesChecklistSidebar from '@/components/dashboard/EntriesChecklistSidebar';
import DashboardPlanPipelineBootstrapper from '@/components/dashboard/DashboardPlanPipelineBootstrapper';
import DashboardSmtOrchestratorBootstrapper from '@/components/dashboard/DashboardSmtOrchestratorBootstrapper';
import ImpersonationBanner from '@/components/dashboard/ImpersonationBanner';
import { prisma } from '@/lib/db';
import { pickBestSmtAuthorization } from '@/lib/smt/authorizationSelection';
import { refreshSmtAuthorizationStatus } from '@/lib/smt/agreements';
import { normalizeEmail } from '@/lib/utils/email';

async function isSmtConfirmationRequired(): Promise<boolean> {
  try {
    const cookieStore = cookies();
    const sessionEmail = cookieStore.get('intelliwatt_user')?.value ?? null;

    if (!sessionEmail) {
      return false;
    }

    const normalizedEmail = normalizeEmail(sessionEmail);
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (!user) {
      return false;
    }

    let house = await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!house) {
      house = await prisma.houseAddress.findFirst({
        where: { userId: user.id } as any,
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
    }

    const targetHouseId = house?.id;

    if (!targetHouseId) {
      return false;
    }

    const authorizationCandidates = await prisma.smtAuthorization.findMany({
      where: {
        userId: user.id,
        houseAddressId: targetHouseId,
        archivedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { id: true, smtStatus: true, smtStatusMessage: true, smtLastSyncAt: true },
    });
    let authorization = pickBestSmtAuthorization(authorizationCandidates);

    if (!authorization) {
      return false;
    }

    // If we *think* SMT is pending, do a best-effort refresh (with cooldown) so users
    // aren’t stuck on the confirmation page after SMT has already confirmed.
    const statusBefore = (authorization.smtStatus ?? '').toLowerCase();
    const isMaybePending = statusBefore === 'pending' || statusBefore === '';
    const lastSyncAt = authorization.smtLastSyncAt ?? null;
    const staleMs = 2 * 60 * 1000; // 2 minutes: avoid hammering on every request
    const isStale = !lastSyncAt || Date.now() - lastSyncAt.getTime() > staleMs;

    if (isMaybePending && isStale) {
      try {
        const refreshed = await refreshSmtAuthorizationStatus(authorization.id);
        const nextAuth = (refreshed as any)?.authorization ?? null;
        if (nextAuth) {
          authorization = {
            ...authorization,
            smtStatus: nextAuth.smtStatus,
            smtStatusMessage: nextAuth.smtStatusMessage,
            smtLastSyncAt: new Date(),
          } as any;
        }
      } catch {
        // ignore; fail-open
      }
    }

    const normalizedStatus = (authorization?.smtStatus ?? '').toLowerCase();
    const normalizedMessage = (authorization?.smtStatusMessage ?? '').toLowerCase();

    const isExplicitPending = normalizedStatus === 'pending' || normalizedStatus === '';
    const messageImpliesPending =
      normalizedMessage.includes('waiting on customer') ||
      normalizedMessage.includes('waiting for customer') ||
      normalizedMessage.includes('email sent') ||
      normalizedMessage.includes('pending approval');

    return isExplicitPending || messageImpliesPending;
  } catch (e: any) {
    // Fail-open: dashboard should never hard-crash due to transient DB issues.
    console.error("[dashboard/layout] isSmtConfirmationRequired failed", { message: e?.message ?? String(e) });
    return false;
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const headerList = headers();
  const matchedPath =
    headerList.get('x-matched-path') ??
    headerList.get('x-pathname') ??
    headerList.get('x-invoke-path') ??
    '';
  const shouldLock = await isSmtConfirmationRequired();
  const isSmtConfirmationRoute = matchedPath.startsWith('/dashboard/smt-confirmation');

  if (shouldLock) {
    if (!isSmtConfirmationRoute) {
      redirect('/dashboard/smt-confirmation');
    }
  } else if (isSmtConfirmationRoute) {
    redirect('/dashboard');
  }

  if (isSmtConfirmationRoute) {
    return <>{children}</>;
  }

  return (
    <IdleGuard>
      <div className="min-h-screen bg-brand-white text-brand-navy">
        <DashboardPlanPipelineBootstrapper />
        <DashboardSmtOrchestratorBootstrapper />
        <EntriesChecklistSidebar />
        <div className="flex flex-col min-w-0">
          <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
            <ImpersonationBanner />
            {children}
          </main>
        </div>
      </div>
    </IdleGuard>
  );
}