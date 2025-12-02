import type { ReactNode } from 'react';

const Intelliwatt = ({ children = 'IntelliWatt™' }: { children?: ReactNode }) => (
  <span className="font-semibold text-[#00E0FF] drop-shadow-[0_0_12px_rgba(0,224,255,0.8)]">{children}</span>
);

const IntelliwattLink = () => (
  <a
    href="https://www.intelliwatt.com"
    target="_blank"
    rel="noopener noreferrer"
    className="font-semibold text-[#00E0FF] underline drop-shadow-[0_0_12px_rgba(0,224,255,0.8)]"
  >
    IntelliWatt™
  </a>
);

const HitTheJackWatt = ({ children = 'HitTheJackWatt™' }: { children?: ReactNode }) => (
  <a
    href="https://www.hitthejackwatt.com"
    target="_blank"
    rel="noopener noreferrer"
    className="font-semibold text-[#39FF14] underline drop-shadow-[0_0_12px_rgba(57,255,20,0.8)]"
  >
    {children}
  </a>
);

const IntellipathLink = () => (
  <a
    href="https://www.intellipath-solutions.com"
    target="_blank"
    rel="noopener noreferrer"
    className="font-semibold text-[#4169E1] underline"
  >
    Intellipath Solutions LLC
  </a>
);

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h2 className="text-2xl font-bold text-[#00E0FF] mt-12 mb-4">{children}</h2>
);

const SubTitle = ({ children }: { children: ReactNode }) => (
  <h3 className="text-xl font-semibold text-brand-white mt-6 mb-3">{children}</h3>
);

const Paragraph = ({ children }: { children: ReactNode }) => (
  <p className="text-brand-white/90 leading-relaxed mb-4 text-lg">{children}</p>
);

export default function RulesPage() {
  return (
    <div className="min-h-screen bg-brand-white">
      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,224,255,0.12),transparent_55%)]" />
        </div>
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-brand-white mb-6">
            <HitTheJackWatt /> Monthly Jackpot – Official Rules
          </h1>
          <p className="text-xl text-brand-white/90 leading-relaxed">
            These rules outline eligibility, entry methods, prize calculations, and winner requirements for the{' '}
            <HitTheJackWatt /> sweepstakes operated by <IntellipathLink />.
          </p>
        </div>
      </section>

      <section className="py-24 px-4 bg-brand-white">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="bg-brand-navy p-8 rounded-2xl border border-brand-blue/40 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
            <SectionTitle>1. No Purchase Necessary</SectionTitle>
            <Paragraph>
              No purchase, payment, or energy plan switch is required to enter or win. Void where prohibited. By participating,
              you agree to abide by these rules and all decisions made by <IntelliwattLink />.
            </Paragraph>

            <SectionTitle>2. Eligibility</SectionTitle>
            <Paragraph>
              Open to legal U.S. residents age 18 or older. Entrants must have a valid email address and mobile number. Employees
              of <IntelliwattLink /> and its affiliates are not eligible to win. Entry is subject to verification and may be
              void if fraudulent or incomplete.
            </Paragraph>

            <SectionTitle>3. How to Enter</SectionTitle>
            <Paragraph>
              There are multiple ways to earn entries in the <HitTheJackWatt /> Sweepstakes. No purchase or plan switch is
              required to enter or win. Void where prohibited.
            </Paragraph>

            <SubTitle>3.1 Usage-Based Entry (Primary Methods)</SubTitle>
            <Paragraph>You may earn entries by providing your electricity usage data through one of the following free methods:</Paragraph>
            <ul className="list-disc list-inside space-y-2 text-brand-white marker:text-[#39FF14]">
              <li>
                <strong>Smart Meter Texas (SMT) Connection:</strong> Connect your SMT account so <Intelliwatt /> can securely
                access usage history. Connecting SMT earns one (1) entry.
              </li>
              <li>
                <strong>Manual Usage Upload:</strong> Upload usage information (bill PDF, CSV, or Green Button file). A
                qualifying usage upload earns one (1) entry.
              </li>
            </ul>
            <Paragraph>
              Entries earned from SMT connection or manual usage upload remain active only while <Intelliwatt /> has electricity
              usage data for you from the preceding twelve (12) months. If your usage data on file becomes older than twelve (12)
              months, these entries expire until you reconnect SMT or upload updated usage data.
            </Paragraph>

            <SubTitle>3.2 Additional Profile-Based Entries</SubTitle>
            <Paragraph>After providing usage data, you may earn additional entries by completing optional profile information:</Paragraph>
            <ul className="list-disc list-inside space-y-2 text-brand-white marker:text-[#39FF14]">
              <li>
                <strong>Current Plan Information:</strong> Providing your current electricity plan information earns one (1) entry.
              </li>
              <li>
                <strong>Home Details:</strong> Completing your home details earns one (1) entry.
              </li>
              <li>
                <strong>Appliance Details:</strong> Completing your appliance details earns one (1) entry.
              </li>
            </ul>
            <Paragraph>
              These profile-based entries remain active only while <Intelliwatt /> has electricity usage data for the preceding
              twelve (12) months. If your usage data becomes older than twelve (12) months, these entries expire until you
              reconnect SMT or upload updated usage data.
            </Paragraph>
            <Paragraph>
              <strong>Availability notice:</strong> Current Plan, Home Details, and Appliance entries stay locked until IntelliWatt
              has active usage on file (via SMT, Green Button, or manual upload). Without current usage data these profile entries
              remain unavailable.
            </Paragraph>

            <SubTitle>3.3 Referral Entries</SubTitle>
            <Paragraph>
              Earn one (1) referral entry for each person you invite who completes registration and provides their own usage data
              (SMT connection or manual upload). Referral entries do not expire and remain associated with your account unless it
              becomes ineligible.
            </Paragraph>
            <Paragraph>
              Referrals are the only entry path available while you are waiting on usage data to sync, so you can continue earning
              entries even if SMT or manual uploads are still pending.
            </Paragraph>

            <SubTitle>3.4 Testimonial Entries (Real Customers Only)</SubTitle>
            <Paragraph>
              Customers who switch plans through <Intelliwatt /> or complete an <IntellipathLink /> energy upgrade may be invited
              to submit a testimonial. A qualifying testimonial earns one (1) testimonial entry that does not expire. Providing a
              testimonial is optional and not required to enter or win.
            </Paragraph>
            <Paragraph>
              Testimonial invitations are issued after your IntelliWatt plan switch is complete and usage remains active; the entry
              unlocks only once those conditions are met.
            </Paragraph>

            <SubTitle>3.5 Alternate Method of Entry (AMOE)</SubTitle>
            <Paragraph>
              Enter without providing usage data by mailing a handwritten postcard with your full name, mailing address, phone
              number, and email address to:
            </Paragraph>
            <Paragraph>
              <span className="pl-4 border-l-2 border-[#00E0FF] block">
                IntelliWatt Sweepstakes – AMOE Entry
                <br />
                PO Box – TBD (Address will be updated by <IntellipathLink />)
              </span>
            </Paragraph>
            <Paragraph>
              Limit one (1) AMOE entry per person per calendar month. Eligible AMOE postcards count as one (1) entry in the
              drawing period that includes that month. Only original handwritten postcards sent via U.S. mail are accepted.
              Emailed entries, digital submissions, photocopies, bulk mailings, and mechanically reproduced entries are not
              valid.
            </Paragraph>

            <SectionTitle>4. Jackpot Amount</SectionTitle>
            <Paragraph>
              The monthly jackpot increases by <strong>$5 for every customer who switches to a commissionable plan</strong> using
              <Intelliwatt />.
            </Paragraph>
            <Paragraph>
              Not all energy plans pay us—and that’s okay. We still recommend whatever saves you the most based on our analysis.
              Only commissionable plans grow the jackpot.
            </Paragraph>
            <ul className="list-disc list-inside space-y-1 text-brand-white marker:text-[#39FF14]">
              <li>100 commissionable switches = $500 jackpot</li>
              <li>1,000 commissionable switches = $5,000 jackpot</li>
            </ul>
            <Paragraph>
              <strong>Note:</strong> You do not have to switch plans or pick a commissionable one to enter or win, but those actions
              help grow the prize pool.
            </Paragraph>

            <SectionTitle>5. Drawing Periods</SectionTitle>
            <Paragraph>
              Drawings occur monthly, on or around the 5th of each month. The entry period runs from 12:00 AM CT on the 1st day
              through 11:59 PM CT on the last day of the month.
            </Paragraph>

            <SectionTitle>6. Winner Selection</SectionTitle>
            <Paragraph>
              One winner is chosen at random from all valid entries that are active at the time of the drawing. Each entry is a
              separate chance to win. Usage-based and profile-based entries must remain active per Section 3. Referral, testimonial,
              and AMOE entries remain active unless the associated account becomes ineligible.
            </Paragraph>

            <SectionTitle>7. Odds of Winning</SectionTitle>
            <Paragraph>
              Odds depend on the total number of eligible entries received and active at the time of the drawing. Maintaining
              current usage data helps keep usage-based and profile-based entries eligible.
            </Paragraph>
            <Paragraph>
              <strong>Example:</strong> 100,000 total active entries = 1 in 100,000 odds per entry.
            </Paragraph>

            <SectionTitle>8. Winner Notification</SectionTitle>
            <Paragraph>
              The winner will be notified via email and/or SMS within 3 business days and must respond within 14 days to complete a
              digital claim form. Failure to complete the claim form within 14 days results in forfeiture of the prize. Alternate
              winners may be selected if unclaimed.
            </Paragraph>

            <SectionTitle>9. Prize Delivery</SectionTitle>
            <Paragraph>
              Prizes are issued via digital payment (PayPal, Venmo, etc.) or mailed check based on the winner’s preference.
            </Paragraph>

            <SectionTitle>10. Additional Terms</SectionTitle>
            <Paragraph>
              By entering, you agree to receive occasional notifications from <Intelliwatt />—not sales pitches, just helpful
              updates. We’ll only reach out to share ways you may be able to save money, get more entries, or learn about new
              energy opportunities in your area. No spam. No pressure. No strings attached.
            </Paragraph>

            <div className="bg-brand-navy/40 border border-brand-blue/40 rounded-2xl p-6 mt-10">
              <h2 className="text-2xl font-bold text-[#00E0FF] mb-4">Ready to win the JackWatt?</h2>
              <Paragraph>
                Sign up now to get your first entry and start maximizing your chances to win!
              </Paragraph>
              <a
                href="/join"
                className="inline-flex items-center gap-2 bg-[#00E0FF] text-brand-navy font-semibold px-6 py-3 rounded-full hover:bg-[#39FF14] transition-colors"
              >
                Sign Up Now <span aria-hidden>→</span>
              </a>
            </div>

            <div className="mt-8 p-4 bg-brand-navy/40 rounded-xl border border-brand-blue/30 text-sm text-brand-white/80">
              <strong>Note:</strong> All sweepstakes entries are subject to official rules and eligibility requirements. Void where
              prohibited by law.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}