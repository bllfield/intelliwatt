'use client';

import type { ReactNode } from 'react';

type FAQItem = { question: string; answer: ReactNode };
type FAQGroup = { title: string; items: FAQItem[] };

const faqGroups: FAQGroup[] = [
  {
    title: '🔹 About IntelliWatt',
    items: [
      {
        question: 'What is IntelliWatt?',
        answer: (
          <>
            <p>
              IntelliWatt is your secure energy insights portal. It analyzes your real electricity usage, compares plans based
              on how your home actually uses power, and gives you clear, data-driven guidance with no pressure and no
              salespeople.
            </p>
            <p>You decide what makes sense. We simply show you the truth.</p>
          </>
        ),
      },
      {
        question: "Why doesn't IntelliWatt have salespeople?",
        answer: (
          <>
            <p>Because sales pressure is the problem we exist to solve.</p>
            <p>
              Most homeowners get pushed into plans or products without understanding real costs. IntelliWatt removes all
              pressure and replaces it with data, transparency, and choice.
            </p>
          </>
        ),
      },
      {
        question: 'How does IntelliWatt stay unbiased?',
        answer: (
          <p>
            We always recommend the plan that produces the lowest total cost based on your real usage - even if the plan does
            not pay us a commission. Your savings come first, always.
          </p>
        ),
      },
      {
        question: 'How does IntelliWatt make money?',
        answer: (
          <p>
            When a plan pays a referral fee and you choose it, IntelliWatt receives compensation. Not all plans pay us - but we
            recommend whichever plan saves you the most, regardless of commission.
          </p>
        ),
      },
      {
        question: 'What makes IntelliWatt different from other comparison sites?',
        answer: (
          <>
            <p>Most sites show you advertised rates, which can be misleading. IntelliWatt uses:</p>
            <ul className="list-disc list-inside space-y-1 marker:text-[#00E0FF]">
              <li>your actual hourly usage</li>
              <li>real plan structures, fees, tiers, and delivery charges</li>
              <li>your home profile and appliances</li>
            </ul>
            <p>This gives you true expected monthly cost, not marketing numbers.</p>
          </>
        ),
      },
      {
        question: 'Why do I need to give you so much data?',
        answer: (
          <p>
            Because good decisions require good information. Your usage varies by season, time of day, HVAC cycles, appliances,
            and lifestyle. The more we know, the more accurate your recommendations and savings estimates become.
          </p>
        ),
      },
      {
        question: 'Why do you ask about my home and appliances?',
        answer: (
          <>
            <p>
              Home size, insulation, HVAC type, appliance mix, and solar or battery details help us model your energy patterns.
              These details let IntelliWatt see:
            </p>
            <ul className="list-disc list-inside space-y-1 marker:text-[#00E0FF]">
              <li>how your home behaves</li>
              <li>where your usage spikes</li>
              <li>what plans fit your lifestyle</li>
              <li>whether solar or batteries are beneficial</li>
            </ul>
          </>
        ),
      },
    ],
  },
  {
    title: '🔹 HitTheJackWatt (Your Entry Point)',
    items: [
      {
        question: 'What is HitTheJackWatt?',
        answer: (
          <>
            <p>
              HitTheJackWatt is our friendly public-facing gateway. It lets you sign up quickly, earn entries for our monthly
              jackpot, and learn about your energy options in a fun, engaging way.
            </p>
            <p>IntelliWatt is where the detailed insights and recommendations live.</p>
          </>
        ),
      },
      {
        question: 'Why am I redirected to IntelliWatt after signing up on HitTheJackWatt?',
        answer: (
          <>
            <p>HitTheJackWatt gets you in the door.</p>
            <p>IntelliWatt is the secure dashboard where your analysis, recommendations, and entries are stored.</p>
          </>
        ),
      },
      {
        question: 'Are both operated by the same company?',
        answer: (
          <p>
            Yes. HitTheJackWatt and IntelliWatt are services of IntelliPath Solutions LLC, a Texas-based energy intelligence
            company.
          </p>
        ),
      },
    ],
  },
  {
    title: '🔹 Trust, Safety, and Data Security',
    items: [
      {
        question: 'Is it safe to connect my smart meter?',
        answer: (
          <>
            <p>
              Yes. IntelliWatt uses Smart Meter Texas, the official state system for accessing your own usage data. You control
              the connection and can revoke it anytime.
            </p>
            <p>All data is encrypted in transit and at rest. We never sell personal information.</p>
          </>
        ),
      },
      {
        question: 'Will I get spammed?',
        answer: (
          <p>
            No. We never sell, share, or rent your contact information. All communication comes directly from IntelliWatt.
          </p>
        ),
      },
      {
        question: 'What do you do with my data?',
        answer: (
          <>
            <p>We use it to:</p>
            <ul className="list-disc list-inside space-y-1 marker:text-[#00E0FF]">
              <li>analyze your usage</li>
              <li>model your home&apos;s patterns</li>
              <li>compare real plans</li>
              <li>manage your entries</li>
            </ul>
            <p>We do not sell or rent personal data.</p>
          </>
        ),
      },
    ],
  },
  {
    title: '🔹 Plan Recommendations & Savings',
    items: [
      {
        question: 'Do you always show the cheapest electricity plan?',
        answer: (
          <>
            <p>We show the lowest total cost plan for your home - not just the lowest advertised rate. This includes:</p>
            <ul className="list-disc list-inside space-y-1 marker:text-[#00E0FF]">
              <li>tiers</li>
              <li>delivery charges</li>
              <li>time-of-use windows</li>
              <li>minimum fees</li>
              <li>seasonal changes</li>
            </ul>
          </>
        ),
      },
      {
        question: 'What if the best plan does not pay IntelliWatt a commission?',
        answer: (
          <p>
            We still recommend it. If it does not pay us, you just do not add $5 to the jackpot. Your savings remain the
            priority.
          </p>
        ),
      },
      {
        question: 'Do you only recommend plans that pay you?',
        answer: (
          <p>
            No. Your savings come first. We recommend whichever plan minimizes your real cost, whether or not it pays
            IntelliWatt.
          </p>
        ),
      },
    ],
  },
  {
    title: '🔹 Using IntelliWatt',
    items: [
      {
        question: 'What happens after I sign up?',
        answer: (
          <>
            <p>You will receive:</p>
            <ul className="list-disc list-inside space-y-1 marker:text-[#00E0FF]">
              <li>plan recommendations when your contract is close to expiring</li>
              <li>alerts if switching early could save you money</li>
              <li>monthly jackpot entries</li>
              <li>access to your energy dashboard anytime</li>
            </ul>
          </>
        ),
      },
      {
        question: 'What kind of data helps IntelliWatt make recommendations?',
        answer: (
          <>
            <p>Smart, precise recommendations come from:</p>
            <ul className="list-disc list-inside space-y-1 marker:text-[#00E0FF]">
              <li>Smart Meter Texas interval data</li>
              <li>uploaded utility bills</li>
              <li>home and appliance details</li>
              <li>solar or battery information</li>
              <li>occupancy and lifestyle habits</li>
            </ul>
          </>
        ),
      },
      {
        question: 'What if I already have solar panels?',
        answer: (
          <>
            <p>
              Mark solar in your profile. IntelliWatt automatically looks for solar buyback plans, time-of-use plans that fit
              solar production, and net-metering style benefits when available.
            </p>
            <p>You can also simulate solar or battery savings before installing.</p>
          </>
        ),
      },
    ],
  },
  {
    title: '🔹 HitTheJackWatt Entries & Jackpot',
    items: [
      {
        question: 'How do I earn entries?',
        answer: (
          <>
            <p>You earn entries by:</p>
            <ul className="list-disc list-inside space-y-1 marker:text-[#00E0FF]">
              <li>connecting Smart Meter Texas or uploading usage</li>
              <li>adding your current electricity plan</li>
              <li>completing home details</li>
              <li>completing appliance details</li>
              <li>referring friends</li>
              <li>submitting a testimonial</li>
              <li>sending an AMOE postcard</li>
            </ul>
          </>
        ),
      },
      {
        question: 'How big is the jackpot?',
        answer: (
          <p>It grows every time someone picks a plan that pays IntelliWatt a referral fee. Each eligible switch adds $5.</p>
        ),
      },
      {
        question: 'Where does the jackpot money come from?',
        answer: <p>From referral compensation paid by providers on certain plans.</p>,
      },
      {
        question: 'How often is the jackpot drawn?',
        answer: (
          <p>
            Monthly, on the 5th. If the jackpot is under $500, entries roll into the next drawing so the pool keeps building.
          </p>
        ),
      },
      {
        question: 'Can I win without switching plans?',
        answer: <p>Yes. Switching helps grow the jackpot, but it is not required to win.</p>,
      },
      {
        question: 'How are winners chosen?',
        answer: (
          <p>
            Each entry equals one ticket. A winner is selected at random and notified by email or text once the drawing
            occurs.
          </p>
        ),
      },
      {
        question: 'How many times can I win?',
        answer: (
          <p>There is no limit. As long as your entries are active, you are eligible every month.</p>
        ),
      },
    ],
  },
];

export default function FAQPage() {
  const renderQuestion = (text: string) => {
    if (!text.includes('HitTheJackWatt')) {
      return text;
    }

    const parts = text.split(/(HitTheJackWatt(?:™)?(?:\.com)?)/g);

    return parts.map((part, index) => {
      if (/^HitTheJackWatt(?:™)?(?:\.com)?$/.test(part)) {
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
            Everything you need to know about IntelliWatt and how we help you understand and lower your energy costs.
          </p>
        </div>
      </section>

      {/* FAQ Content */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto space-y-16 text-brand-navy">
          {faqGroups.map(({ title, items }) => (
            <div key={title} className="space-y-8">
              <h2 className="text-3xl md:text-4xl font-semibold">{title}</h2>
              <div className="space-y-8">
                {items.map(({ question, answer }) => (
                  <div
                    key={question}
                    className="bg-brand-navy p-8 rounded-2xl border border-brand-blue/40 shadow-[0_20px_60px_rgba(0,0,0,0.45)] hover:border-brand-blue/80 transition-all duration-300"
                  >
                    <h3 className="text-2xl font-bold text-[#00E0FF] mb-4">{renderQuestion(question)}</h3>
                    <div className="text-brand-white text-lg leading-relaxed space-y-3">{answer}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
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
            <a
              href="/join"
              className="bg-brand-blue text-brand-navy font-bold py-4 px-8 rounded-full text-lg hover:bg-brand-cyan transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-brand-blue/25"
            >
              Get Started Free
            </a>
            <a
              href="/how-it-works"
              className="text-brand-white border-2 border-brand-blue px-8 py-4 rounded-full font-semibold hover:bg-brand-blue hover:text-brand-navy transition-all duration-300"
            >
              Learn More
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}