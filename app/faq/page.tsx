'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';

const faqItems: { question: string; answer: ReactNode }[] = [
  {
    question: 'What is HitTheJackWatt™?',
    answer: (
      <p>
        HitTheJackWatt™ is a free monthly drawing where members can win cash by securely sharing their energy data and
        referring friends. The jackpot grows as more people switch to a better plan through IntelliWatt™.
      </p>
    ),
  },
  {
    question: 'How much does it cost to join?',
    answer: <p>Nothing. It is completely free to enter, earn entries, and win—no purchase necessary.</p>,
  },
  {
    question: 'What’s the catch?',
    answer: (
      <p>
        There isn’t one. IntelliWatt™ earns referral compensation when you switch through us—similar to a broker. That funds
        the jackpot and keeps the service free.
      </p>
    ),
  },
  {
    question: 'Is it safe to connect my smart meter?',
    answer: (
      <p>
        Yes. We use Smart Meter Texas—the official state data portal. You control access and can revoke it at any time.
        Usage data is encrypted in transit and at rest, we never sell personal information, and aggregated insights are
        de-identified.
      </p>
    ),
  },
  {
    question: 'Will I get spam calls or emails?',
    answer: (
      <p>
        Never. We do not sell your information and we do not allow third-party spam. All communication comes directly from us
        and only when helpful.
      </p>
    ),
  },
  {
    question: 'What do you do with my data?',
    answer: (
      <p>
        We analyze your bill, compare plans from our growing provider network (starting with WattBuy), estimate savings,
        and manage your jackpot entries. We do not sell or rent personal data; any aggregate analysis is de-identified.
      </p>
    ),
  },
  {
    question: 'What kind of data do you use to make recommendations?',
    answer: (
      <p>
        We combine Smart Meter Texas data (with your permission) or your uploaded bill with home and appliance details. Our
        algorithm models hourly usage to match you with the lowest-cost plan available through our provider network.
      </p>
    ),
  },
  {
    question: 'What is IntelliWatt™? Why am I redirected there after signing up?',
    answer: (
      <>
        <p>
          <a
            href="https://www.intelli-watt.com"
            className="font-semibold text-[#00F0FF] underline drop-shadow-[0_0_12px_rgba(0,240,255,0.8)]"
          >
            IntelliWatt™
          </a>{' '}
          is the secure user portal where your entries, insights, and plan recommendations live. When you log in using a
          magic link you land on the IntelliWatt™ dashboard—the brains behind HitTheJackWatt™.
        </p>
        <p>
          HitTheJackWatt™ and{' '}
          <a
            href="https://www.intelli-watt.com"
            className="font-semibold text-[#00F0FF] underline drop-shadow-[0_0_12px_rgba(0,240,255,0.8)]"
          >
            IntelliWatt™
          </a>{' '}
          are operated by{' '}
          <a
            href="https://www.intellipath-solutions.com"
            className="font-semibold text-[#4169E1] underline drop-shadow-[0_0_6px_rgba(65,105,225,0.5)]"
          >
            Intellipath Solutions LLC
          </a>
          , a Texas-based energy intelligence company.
        </p>
      </>
    ),
  },
  {
    question: 'What happens after I sign up?',
    answer: (
      <p>
        You will get recommendations when your current plan comes due—or sooner if switching early could save you money.
        You also earn entries in the monthly jackpot and can update your info or switch plans whenever you like.
      </p>
    ),
  },
  {
    question: 'How do I earn entries?',
    answer: (
      <>
        <p>You can earn entries by:</p>
        <ul className="list-disc list-inside space-y-1 marker:text-[#00E0FF]">
          <li>1 for connecting Smart Meter Texas (where available) or uploading usage manually</li>
          <li>1 for adding your current electricity plan information</li>
          <li>1 for completing your home details</li>
          <li>1 for completing your appliance details</li>
          <li>1 for every referral who connects SMT or uploads usage</li>
          <li>1 for submitting a testimonial if you switched through IntelliWatt™ or completed an IntelliPath upgrade</li>
          <li>1 per person per calendar month via the free Alternate Method of Entry (AMOE) postcard</li>
        </ul>
        <p className="mt-3">
          Usage- and profile-based entries remain active while we have usage data from the past 12 months. Referral and
          testimonial entries never expire. AMOE entries count for the drawing period in which they are received.
        </p>
      </>
    ),
  },
  {
    question: 'How big is the jackpot?',
    answer: (
      <p>
        The jackpot grows as members switch to plans through{' '}
        <a
          href="https://www.intelli-watt.com"
          className="font-semibold text-[#00F0FF] underline drop-shadow-[0_0_12px_rgba(0,240,255,0.8)]"
        >
          IntelliWatt™
        </a>
        . It resets after each drawing and then starts growing again.
      </p>
    ),
  },
  {
    question: 'Where does the jackpot money come from?',
    answer: (
      <p>
        When someone selects a plan that pays IntelliWatt™ a referral commission, we add $5 to the jackpot. Not all plans
        pay us, but when they do, the value goes back to the community.
      </p>
    ),
  },
  {
    question: 'How often is the jackpot drawn?',
    answer: (
      <p>
        Drawings occur monthly on the 5th. Keep your usage data current (within 12 months) so profile entries remain active.
        Referral, testimonial, and AMOE entries remain active without expiring.
      </p>
    ),
  },
  {
    question: 'When is the drawing held?',
    answer: <p>A winner is drawn once the jackpot reaches at least $500. If it does not, entries roll over to the next drawing.</p>,
  },
  {
    question: 'Do I have to switch plans to win?',
    answer: <p>No. You can participate and win without switching, though switching helps grow the jackpot.</p>,
  },
  {
    question: 'Do you always show the cheapest electricity plan?',
    answer: (
      <p>
        Not always. We show the best-fit plan based on how your home actually uses energy. Some low advertised rates cost
        more once fees, tiers, or time-of-use differences are factored in. We calculate total cost—not just cents per kWh.
      </p>
    ),
  },
  {
    question: "What happens if the best plan doesn't pay you a commission?",
    answer: (
      <p>
        We still recommend it. We only add $5 to the jackpot when a member picks a plan that pays us a referral fee, but our
        guidance always centers on what saves you the most.
      </p>
    ),
  },
  {
    question: 'Do you only recommend plans that pay you?',
    answer: (
      <p>
        No. We always recommend the plan that saves you the most based on real usage. If you choose a plan that pays us, we
        add $5 to the jackpot on your behalf.
      </p>
    ),
  },
  {
    question: 'How many times can I win?',
    answer: (
      <p>
        There is no limit. As long as your qualifying entries remain active (and usage-based entries stay current), you are
        eligible for every drawing.
      </p>
    ),
  },
  {
    question: 'How are winners chosen?',
    answer: <p>Each entry is one ticket in the monthly drawing. Winners are picked at random and notified via email or SMS.</p>,
  },
  {
    question: 'How will I know if I win?',
    answer: (
      <p>
        IntelliWatt™ notifies winners by email and/or text. Keep your contact info current—sometimes we even surprise winners
        in person.
      </p>
    ),
  },
  {
    question: 'What if I already have solar panels?',
    answer: (
      <p>
        We support solar homes. Mark solar in your profile and IntelliWatt™ looks for buyback plans and time-of-use rates
        that fit your setup. Planning solar? You can simulate savings before you install.
      </p>
    ),
  },
];

export default function FAQPage() {

  return (
    <div className="min-h-screen bg-brand-white">
      {/* Hero Section */}
      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
        </div>
        
        <div className="relative z-10 max-w-6xl mx-auto text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-brand-white mb-6">
            Frequently Asked <span className="text-brand-blue">Questions</span>
          </h1>
          <p className="text-xl text-brand-white max-w-3xl mx-auto leading-relaxed">
            Everything you need to know about IntelliWatt™ and how we help you save on your energy bills.
          </p>
        </div>
      </section>

      {/* FAQ Content */}
      <section className="py-24 px-4 bg-brand-white">
        <div className="max-w-4xl mx-auto">
          <div className="space-y-8">
            {faqItems.map(({ question, answer }) => (
              <div
                key={question}
                className="bg-brand-navy p-8 rounded-2xl border border-brand-blue/40 shadow-[0_20px_60px_rgba(0,0,0,0.45)] hover:border-brand-blue/80 transition-all duration-300"
              >
                <h3 className="text-2xl font-bold text-[#00F0FF] drop-shadow-[0_0_12px_rgba(0,240,255,0.6)] mb-4">
                  {question}
                </h3>
                <div className="text-[#00E0FF] text-lg leading-relaxed space-y-3 drop-shadow-[0_0_10px_rgba(0,224,255,0.35)]">
                  {answer}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-4 bg-brand-navy">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-brand-white mb-8">
            Ready to Start <span className="text-brand-blue">Saving</span>?
          </h2>
          <p className="text-xl text-brand-white mb-12 max-w-3xl mx-auto">
            Join thousands of homeowners who are already saving hundreds on their energy bills with IntelliWatt™.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a href="/join" className="bg-brand-blue text-brand-navy font-bold py-4 px-8 rounded-full text-lg hover:bg-brand-cyan transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-brand-blue/25">
              Get Started Free
            </a>
            <a href="/how-it-works" className="text-brand-white border-2 border-brand-blue px-8 py-4 rounded-full font-semibold hover:bg-brand-blue hover:text-brand-navy transition-all duration-300">
              Learn More
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 px-4 bg-brand-navy border-t border-brand-blue/20">
        <div className="max-w-6xl mx-auto">
          {/* Main Footer Content */}
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            {/* Company Info */}
            <div className="md:col-span-2">
              <div className="flex items-center mb-6">
                <div className="relative w-32 h-16 mr-4">
                  <Image
                    src="/IntelliWatt Logo TM.png"
                    alt="IntelliWatt™ Logo"
                    fill
                    className="object-contain"
                  />
                </div>
              </div>
              <p className="text-brand-white text-lg leading-relaxed mb-6 max-w-md">
                Stop overpaying for power with our AI-powered energy plan optimization. 
                Smart algorithms find the perfect plan for your unique usage patterns.
              </p>
              
              <div className="flex space-x-4">
                <a href="#" className="text-brand-white hover:text-brand-blue transition-colors">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z"/>
                  </svg>
                </a>
                <a href="#" className="text-brand-white hover:text-brand-blue transition-colors">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 4.21a4.22 4.22 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.98 8.521 8.521 0 0 1-5.33 1.84c-.34 0-.68-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z"/>
                  </svg>
                </a>
                <a href="#" className="text-brand-white hover:text-brand-blue transition-colors">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                </a>
              </div>
            </div>
            
            {/* Quick Links */}
            <div>
              <h3 className="text-brand-white font-semibold mb-4">Quick Links</h3>
              <ul className="space-y-2">
                <li><a href="/how-it-works" className="text-brand-white hover:text-brand-blue transition-colors">How It Works</a></li>
                <li><a href="/faq" className="text-brand-white hover:text-brand-blue transition-colors">FAQ</a></li>
                <li><a href="/privacy" className="text-brand-white hover:text-brand-blue transition-colors">Privacy Policy</a></li>
                <li><a href="/terms" className="text-brand-white hover:text-brand-blue transition-colors">Terms of Service</a></li>
              </ul>
            </div>
            
            {/* Support */}
            <div>
              <h3 className="text-brand-white font-semibold mb-4">Support</h3>
              <ul className="space-y-2">
                <li><a href="/contact" className="text-brand-white hover:text-brand-blue transition-colors">Contact Us</a></li>
                <li><a href="/help" className="text-brand-white hover:text-brand-blue transition-colors">Help Center</a></li>
                <li><a href="/status" className="text-brand-white hover:text-brand-blue transition-colors">Service Status</a></li>
              </ul>
            </div>
          </div>
          
          {/* Bottom Footer */}
          <div className="border-t border-brand-blue/20 pt-8 text-center">
            <p className="text-brand-white">
              © 2024 IntelliWatt™. All rights reserved. Patent pending.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
} 