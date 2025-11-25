const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-2xl font-semibold text-brand-blue mt-10 mb-4">{children}</h2>
);

const SubTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-xl font-semibold text-brand-cyan mt-6 mb-3">{children}</h3>
);

export default function RulesPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy relative overflow-hidden">
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
      </div>

      <main className="relative max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold mb-8 text-brand-blue">
          <a
            href="https://www.hitthejackwatt.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-transparent transition hover:decoration-brand-blue"
          >
            HitTheJackWatt™
          </a>{' '}
          Monthly Jackpot – Official Rules
        </h1>

        <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 p-8 rounded-2xl border border-brand-blue/10 backdrop-blur-sm text-brand-white space-y-6">
          <SectionTitle>1. No Purchase Necessary</SectionTitle>
          <p>
            No purchase, payment, or energy plan switch is required to enter or win. Void where prohibited. By
            participating, you agree to abide by these rules and all decisions made by{' '}
            <a href="https://www.intelli-watt.com" className="text-brand-cyan underline">
              IntelliWatt™
            </a>
            .
          </p>

          <SectionTitle>2. Eligibility</SectionTitle>
          <p>
            Open to legal U.S. residents age 18 or older. Must have a valid email address and mobile number.
            Employees of{' '}
            <a href="https://www.intelli-watt.com" className="text-brand-cyan underline">
              IntelliWatt™
            </a>{' '}
            or its affiliates are not eligible to win. Entry is subject to verification and may be void if fraudulent
            or incomplete.
          </p>

          <SectionTitle>3. How to Enter</SectionTitle>
          <p>
            There are multiple ways to earn entries in the{' '}
            <a
              href="https://www.hitthejackwatt.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand-blue underline decoration-transparent transition hover:decoration-brand-blue"
            >
              HitTheJackWatt™
            </a>{' '}
            Sweepstakes. No purchase or plan switch is required to enter or win. Void where prohibited.
          </p>

          <SubTitle>3.1 Usage-Based Entry (Primary Methods)</SubTitle>
          <p>You may earn entries by providing your electricity usage data through one of the following free methods:</p>
          <ul className="list-disc list-inside space-y-2">
            <li>
              <strong>Smart Meter Texas (“SMT”) Connection:</strong> Connect your SMT account so IntelliWatt™ can securely
              access usage history. Connecting SMT earns one (1) entry.
            </li>
            <li>
              <strong>Manual Usage Upload:</strong> Upload usage information (bill PDF, CSV, or Green Button file). A
              qualifying usage upload earns one (1) entry.
            </li>
          </ul>
          <p>
            Entries earned from SMT connection or manual usage upload remain active only while IntelliWatt™ has
            electricity usage data for you from the preceding twelve (12) months. If your usage data on file becomes
            older than twelve (12) months, these entries expire until you reconnect SMT or upload updated usage data.
          </p>

          <SubTitle>3.2 Additional Profile-Based Entries</SubTitle>
          <p>After providing usage data, you may earn additional entries by completing optional profile information:</p>
          <ul className="list-disc list-inside space-y-2">
            <li>
              <strong>Current Plan Information:</strong> Providing your current electricity plan information earns
              one (1) entry.
            </li>
            <li>
              <strong>Home Details:</strong> Completing your home details earns one (1) entry.
            </li>
            <li>
              <strong>Appliance Details:</strong> Completing your appliance details earns one (1) entry.
            </li>
          </ul>
          <p>
            These profile-based entries remain active only while IntelliWatt™ has electricity usage data for the preceding
            twelve (12) months. If your usage data becomes older than twelve (12) months, these entries expire until
            you reconnect SMT or upload updated usage data.
          </p>

          <SubTitle>3.3 Referral Entries</SubTitle>
          <p>
            Earn one (1) referral entry for each person you invite who completes registration and provides their own usage
            data (SMT connection or manual upload). Referral entries do not expire and remain associated with your account
            unless it becomes ineligible.
          </p>

          <SubTitle>3.4 Testimonial Entries (Real Customers Only)</SubTitle>
          <p>
            Customers who switch plans through IntelliWatt™ or complete an Intellipath Solutions LLC energy upgrade may
            be invited to submit a testimonial. A qualifying testimonial earns one (1) testimonial entry that does not
            expire. Providing a testimonial is optional and not required to enter or win.
          </p>

          <SubTitle>3.5 Alternate Method of Entry (“AMOE”)</SubTitle>
          <p>
            Enter without providing usage data by mailing a handwritten postcard with your full name, mailing address,
            phone number, and email address to:
          </p>
          <p className="pl-4 border-l-2 border-brand-blue">
            IntelliWatt Sweepstakes – AMOE Entry<br />
            PO Box – TBD (Address will be updated by Intellipath Solutions LLC)
          </p>
          <p>
            Limit one (1) AMOE entry per person per calendar month. Eligible AMOE postcards count as one (1) entry in
            the drawing period that includes that month. Only original handwritten postcards sent via U.S. mail are
            accepted. Emailed entries, digital submissions, photocopies, bulk mailings, and mechanically reproduced
            entries are not valid.
          </p>

          <SectionTitle>4. Jackpot Amount</SectionTitle>
          <p>
            The monthly jackpot increases by <strong>$5 for every customer who switches to a commissionable plan</strong> using
            IntelliWatt™.
          </p>
          <p>
            Not all energy plans pay us—and that’s okay. We still recommend whatever saves you the most based on our
            analysis. Only commissionable plans grow the jackpot.
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>100 commissionable switches = $500 jackpot</li>
            <li>1,000 commissionable switches = $5,000 jackpot</li>
          </ul>
          <p>
            <strong>Note:</strong> You do not have to switch plans or pick a commissionable one to enter or win, but those
            actions help grow the prize pool.
          </p>

          <SectionTitle>5. Drawing Periods</SectionTitle>
          <p>
            Drawings occur monthly, on or around the 5th of each month. The entry period runs from 12:00 AM CT on the 1st
            day through 11:59 PM CT on the last day of the month.
          </p>

          <SectionTitle>6. Winner Selection</SectionTitle>
          <p>
            One winner is chosen at random from all valid entries that are active at the time of the drawing. Each entry
            is a separate chance to win. Usage-based and profile-based entries must remain active per Section 3. Referral,
            testimonial, and AMOE entries remain active unless the associated account becomes ineligible.
          </p>

          <SectionTitle>7. Odds of Winning</SectionTitle>
          <p>
            Odds depend on the total number of eligible entries received and active at the time of the drawing. Maintaining
            current usage data helps keep usage-based and profile-based entries eligible.
          </p>
          <p>
            <strong>Example:</strong> 100,000 total active entries = 1 in 100,000 odds per entry.
          </p>

          <SectionTitle>8. Winner Notification</SectionTitle>
          <p>
            The winner will be notified via email and/or SMS within 3 business days and must respond within 14 days to
            complete a digital claim form. Failure to complete the claim form within 14 days results in forfeiture of the
            prize. Alternate winners may be selected if unclaimed.
          </p>

          <SectionTitle>9. Prize Delivery</SectionTitle>
          <p>
            Prizes are issued via digital payment (PayPal, Venmo, etc.) or mailed check based on the winner’s preference.
          </p>

          <SectionTitle>10. Additional Terms</SectionTitle>
          <p>
            By entering, you agree to receive occasional notifications from{' '}
            <a href="https://www.intelli-watt.com" className="text-brand-cyan underline">
              IntelliWatt™
            </a>
            —not sales pitches, just helpful updates. We’ll only reach out to share ways you may be able to save money,
            get more entries, or learn about new energy opportunities in your area. No spam. No pressure. No strings
            attached.
          </p>

          <div className="bg-brand-blue/10 border border-brand-blue/20 rounded-xl p-6 mt-10 text-brand-cyan">
            <h2 className="text-2xl font-semibold mb-4 text-brand-blue">Ready to win the JackWatt?</h2>
            <p className="mb-4 text-brand-white">
              Sign up now to get your first entry and start maximizing your chances to win!
            </p>
            <a
              href="https://www.intelli-watt.com/join"
              className="inline-flex items-center gap-2 bg-brand-blue text-brand-navy font-semibold px-5 py-3 rounded-full hover:bg-brand-cyan transition-colors"
            >
              Sign Up Now <span aria-hidden>→</span>
            </a>
          </div>

          <div className="mt-8 p-4 bg-brand-blue/10 rounded-lg border border-brand-blue/20 text-sm text-brand-cyan">
            <strong>Note:</strong> All sweepstakes entries are subject to official rules and eligibility requirements.
            Void where prohibited by law.
          </div>
        </div>
      </main>
    </div>
  );
}