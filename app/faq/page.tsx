'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';

const faqItems: { question: string; answer: ReactNode }[] = [
  {
    question: 'What is HitTheJackWatt™?',
    answer: (
      <p>
        <a
          href="https://www.hitthejackwatt.com"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-[#39FF14] underline drop-shadow-[0_0_12px_rgba(57,255,20,0.8)]"
        >
          HitTheJackWatt™
        </a>{' '}
        is a free monthly drawing where members can win cash by securely sharing their energy data and referring friends.
        The jackpot grows as more people switch to a better plan through{' '}
        <span className="font-semibold text-[#00E0FF] underline drop-shadow-[0_0_12px_rgba(0,224,255,0.8)]">
          IntelliWatt™
        </span>
        .
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
            href="https://www.intelliwatt.com"
            className="font-semibold text-[#00E0FF] underline drop-shadow-[0_0_12px_rgba(0,224,255,0.8)]"
          >
            IntelliWatt™
          </a>{' '}
          is the secure user portal where your entries, insights, and plan recommendations live. When you log in using a
          magic link you land on the IntelliWatt™ dashboard—the brains behind{' '}
          <a
            href="https://www.hitthejackwatt.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[#39FF14] underline drop-shadow-[0_0_12px_rgba(57,255,20,0.8)]"
          >
            HitTheJackWatt™
          </a>
          .
        </p>
        <p>
          <a
            href="https://www.hitthejackwatt.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[#39FF14] underline drop-shadow-[0_0_12px_rgba(57,255,20,0.8)]"
          >
            HitTheJackWatt™
          </a>{' '}
          and{' '}
          <a
            href="https://www.intelliwatt.com"
            className="font-semibold text-[#00E0FF] underline drop-shadow-[0_0_12px_rgba(0,224,255,0.8)]"
          >
            IntelliWatt™
          </a>{' '}
          are operated by{' '}
          <a
            href="https://www.intellipath-solutions.com"
            className="font-semibold text-[#4169E1] underline"
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
          href="https://www.intelliwatt.com"
          className="font-semibold text-[#00E0FF] underline drop-shadow-[0_0_12px_rgba(0,224,255,0.8)]"
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
  const renderQuestion = (text: string) => {
    if (!text.includes('HitTheJackWatt')) {
      return text;
    }

    const parts = text.split(/(HitTheJackWatt™(?:\.com)?)/g);

    return parts.map((part, index) => {
      if (/^HitTheJackWatt™(?:\.com)?$/.test(part)) {
        return (
          <a
            key={`htjw-${index}`}
            href="https://www.hitthejackwatt.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[#39FF14] underline drop-shadow-[0_0_12px_rgba(57,255,20,0.8)]"
          >
            {part}
          </a>
        );
      }

      return part;
    });
  };

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
                <h3 className="text-2xl font-bold text-[#00E0FF] mb-4">
                  {renderQuestion(question)}
                </h3>
                <div className="text-brand-white text-lg leading-relaxed space-y-3">
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

    </div>
  );
} 