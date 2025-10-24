import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Admin Dashboard - IntelliWatt™',
  description: 'IntelliWatt Admin Dashboard for managing users, commissions, and system settings.',
  icons: {
    icon: '/favicon.ico',
  },
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="admin-layout">
      {children}
    </div>
  )
}
