import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import IdleGuard from '@/components/IdleGuard';
import EntriesChecklistSidebar from '@/components/dashboard/EntriesChecklistSidebar';
import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils/email';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function isSmtConfirmationRequired(): Promise<boolean> {
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
    select: { smtStatus: true },
  });

  if (!authorization) {
    return false;
  }

  const normalizedStatus = (authorization.smtStatus ?? '').toLowerCase();
  const isPending = normalizedStatus === 'pending' || normalizedStatus === '';

  return isPending;
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const shouldLock = await isSmtConfirmationRequired();

  if (shouldLock) {
    redirect('/dashboard/smt-confirmation');
  }

  return (
    <IdleGuard>
      <div className="min-h-screen bg-brand-white text-brand-navy">
        <EntriesChecklistSidebar />
        <div className="flex flex-col min-w-0">
          <main className="flex-1 p-6 max-w-6xl mx-auto w-full">{children}</main>
        </div>
      </div>
    </IdleGuard>
  );
}