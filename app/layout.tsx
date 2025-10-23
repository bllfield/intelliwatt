import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'IntelliWatt™ - HitTheJackWatt™',
  description: 'Optimize your energy usage and find the best electricity plans with AI-powered insights.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-brand-white text-brand-navy">
        <header className="p-4 bg-brand-navy text-brand-blue font-bold shadow-lg border-b border-brand-blue/20">
          <div className="max-w-6xl mx-auto flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <a href="/" className="text-xl font-bold text-brand-blue hover:text-brand-white transition-colors">IntelliWatt™</a>
            </div>
            <nav className="hidden md:flex space-x-6 text-sm">
              <a href="/how-it-works" className="text-brand-blue hover:text-brand-white transition-colors">How It Works</a>
              <a href="/faq" className="text-brand-blue hover:text-brand-white transition-colors">FAQ</a>
              <a href="/privacy-policy" className="text-brand-blue hover:text-brand-white transition-colors">Privacy</a>
              <a href="/rules" className="text-brand-blue hover:text-brand-white transition-colors">Rules</a>
              <a href="/admin" className="text-brand-blue hover:text-brand-white transition-colors font-semibold">Admin</a>
            </nav>
            <div className="md:hidden">
              <span className="text-sm text-brand-blue">Menu</span>
            </div>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
} 