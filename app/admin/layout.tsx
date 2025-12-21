import type { Metadata } from 'next'
import Link from "next/link";

export const metadata: Metadata = {
  title: 'Admin Dashboard - IntelliWatt™',
  description: 'IntelliWatt Admin Dashboard for managing users, commissions, and system settings.',
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="admin-layout">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 bg-white">
        <Link href="/admin" className="text-sm font-semibold text-gray-700 hover:text-gray-900">
          Admin Dashboard
        </Link>
        <a
          href="/admin/logout"
          className="text-sm font-semibold text-red-600 hover:text-red-700"
        >
          Logout
        </a>
      </div>
      {children}
    </div>
  )
}
