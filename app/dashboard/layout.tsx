import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import IdleGuard from '@/components/IdleGuard';
import EntriesChecklistSidebar from '@/components/dashboard/EntriesChecklistSidebar';
import DashboardPlanPipelineBootstrapper from '@/components/dashboard/DashboardPlanPipelineBootstrapper';
import { prisma } from '@/lib/db';
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

    const authorization = await prisma.smtAuthorization.findFirst({
      where: {
        userId: user.id,
        houseAddressId: targetHouseId,
        archivedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: { smtStatus: true, smtStatusMessage: true },
    });

    if (!authorization) {
      return false;
    }

    const normalizedStatus = (authorization.smtStatus ?? '').toLowerCase();
    const normalizedMessage = (authorization.smtStatusMessage ?? '').toLowerCase();

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
        <EntriesChecklistSidebar />
        <div className="flex flex-col min-w-0">
          <main className="flex-1 p-6 max-w-6xl mx-auto w-full">{children}</main>
        </div>
      </div>
    </IdleGuard>
  );
}