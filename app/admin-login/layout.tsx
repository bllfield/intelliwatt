import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Admin Login - IntelliWatt™',
  description: 'Secure admin access to IntelliWatt admin panel.',
}

export default function AdminLoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="admin-login-layout">
      {children}
    </div>
  )
}
