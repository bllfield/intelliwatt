import Image from 'next/image'
import Footer from '@/components/Footer'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="p-4 bg-brand-navy text-brand-blue font-bold shadow-lg border-b border-brand-blue/20">
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
    </>
  )
}
