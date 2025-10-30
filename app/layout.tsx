import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Image from 'next/image'
import './globals.css'
import Footer from '@/components/Footer'
import ClientEntriesCounter from '../components/ClientEntriesCounter'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'IntelliWatt™ - HitTheJackWatt™',
  description: 'Optimize your energy usage and find the best electricity plans with AI-powered insights.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY && (
          <script
            src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places&loading=async`}
            async
            defer
          />
        )}
      </head>
      <body className="bg-brand-white text-brand-navy">
        <header className="px-4 py-2 bg-brand-navy text-brand-blue font-bold shadow-lg border-b border-brand-blue/20">
          <div className="max-w-6xl mx-auto flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <a href="/">
                <div className="relative w-32 h-32">
                  <Image
                    src="/IntelliWatt Logo.png"
                    alt="IntelliWatt™ Logo"
                    fill
                    className="object-contain"
                  />
                </div>
              </a>
              {/* Jackpot total indicator */}
              <div className="hidden sm:flex items-center gap-4 pl-3 border-l border-brand-blue/20 ml-2">
                <div className="relative" style={{ width: '9.492rem', height: '3.39rem' }}>
                  <Image src="/Hitthejackwatt-Logo.png" alt="HitTheJackWatt" fill className="object-contain" />
                </div>
                <div className="text-xs leading-tight flex flex-col items-center">
                  <div className="font-semibold" style={{ color: '#39FF14' }}>Total Entries</div>
                  <div className="mt-0.5">
                    <ClientEntriesCounter />
                  </div>
                </div>
              </div>
            </div>
            <nav className="hidden md:flex space-x-6 text-sm">
              <a href="/how-it-works" className="text-brand-blue hover:text-brand-white transition-colors">How It Works</a>
              <a href="/faq" className="text-brand-blue hover:text-brand-white transition-colors">FAQ</a>
              <a href="/privacy-policy" className="text-brand-blue hover:text-brand-white transition-colors">Privacy</a>
              <a href="/rules" className="text-brand-blue hover:text-brand-white transition-colors">Rules</a>
            </nav>
            <div className="md:hidden">
              <span className="text-sm text-brand-blue">Menu</span>
            </div>
          </div>
        </header>
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
} 