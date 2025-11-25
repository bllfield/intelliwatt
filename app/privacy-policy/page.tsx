import type { ReactNode } from 'react';

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h2 className="text-2xl font-semibold mt-10 mb-4 text-brand-blue">{children}</h2>
);

const Paragraph = ({ children }: { children: ReactNode }) => (
  <p className="text-brand-white leading-relaxed mb-4">{children}</p>
);

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy relative overflow-hidden">
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
      </div>

      <main className="relative max-w-4xl mx-auto px-6 py-12 space-y-6">
        <h1 className="text-4xl font-bold text-brand-blue">Privacy Policy</h1>
        <p className="text-brand-white font-semibold">Effective Date: May 17, 2025</p>

        <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 p-8 rounded-2xl border border-brand-blue/10 backdrop-blur-sm text-brand-white">
          <Paragraph>
            IntelliWatt™ is built to save you money—not guess about your bill. To recommend the right electricity plan for
            <em> your</em> home, we need the same information every provider, broker, or advisor needs: your real usage
            data. This policy explains how we collect, use, and safeguard that information for both IntelliWatt™ and the{' '}
            <a
              href="https://www.hitthejackwatt.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand-blue underline decoration-transparent transition hover:decoration-brand-blue"
            >
              HitTheJackWatt™
            </a>{' '}
            rewards program.
          </Paragraph>

          <SectionTitle>How We Use Your Electricity Usage Data</SectionTitle>
          <Paragraph>
            Every home is different, and so is every usage pattern. When you share your usage data with us, our systems can
            understand details such as:
          </Paragraph>
          <ul className="list-disc list-inside space-y-2 mb-4">
            <li>How much power you use during the day versus at night</li>
            <li>Seasonal swings and shoulder-month usage changes</li>
            <li>The share of your bill driven by HVAC or other large systems</li>
            <li>How much energy you use during peak vs. off-peak hours</li>
            <li>Whether “free nights,” “free weekends,” solar buyback, or other plan types could save you money</li>
          </ul>
          <Paragraph>
            The more accurate your usage data, the better IntelliWatt™ can analyze your real costs. We compare your usage
            against plans available through our growing provider network—starting with WattBuy—to estimate what each plan
            would have cost you. Then we highlight the lowest-priced options for your specific pattern.
          </Paragraph>
          <Paragraph>
            Without usage data, IntelliWatt™ can’t run the full analysis engine. Sharing your usage allows us to do real
            math on your situation instead of relying on generic averages.
          </Paragraph>
          <Paragraph>You can provide your usage in two primary ways:</Paragraph>
          <ul className="list-disc list-inside space-y-2 mb-4">
            <li>
              <strong>Smart Meter Texas (SMT):</strong> Connect your account so we can securely access your interval data.
            </li>
            <li>
              <strong>Manual upload:</strong> Upload a bill, CSV, or Green Button file with your usage history.
            </li>
          </ul>
          <Paragraph>
            To keep results and profile-based entries active, we recommend keeping at least the most recent 12 months of
            usage data on file.
          </Paragraph>

          <SectionTitle>Data Sharing and Privacy</SectionTitle>
          <Paragraph>
            We take your privacy seriously. Here is how we handle your electricity usage data in connection with IntelliWatt™
            and{' '}
            <a
              href="https://www.hitthejackwatt.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand-blue underline decoration-transparent transition hover:decoration-brand-blue"
            >
              HitTheJackWatt™
            </a>
            :
          </Paragraph>
          <ul className="list-disc list-inside space-y-2 mb-4">
            <li>
              <strong>No sale of personal data:</strong> We do not sell or rent your personal information or individual
              usage data to third-party marketers.
            </li>
            <li>
              <strong>Service use only:</strong> Usage data is used to analyze bills, recommend plans, estimate savings, and
              operate IntelliWatt™ features.
            </li>
            <li>
              <strong>Aggregated analysis:</strong> We may combine your data with others in aggregated, de-identified form
              to improve our models. Those aggregates cannot reasonably be traced back to you.
            </li>
            <li>
              <strong>Limited partner sharing:</strong> When needed to deliver the service (e.g., to compare plans or
              facilitate a switch), we share limited information with trusted partners under strict contractual controls.
            </li>
            <li>
              <strong>Your control:</strong> You may revoke SMT access or request deletion of your account and associated
              data (subject to legal retention requirements) by contacting us.
            </li>
          </ul>

          <SectionTitle>1. Information IntelliWatt™ Collects</SectionTitle>
          <Paragraph>
            With your consent, IntelliWatt™ may collect Smart Meter Texas interval data, manual usage uploads, and details
            you provide about your home and household. We also collect account information such as name, email, phone
            number, and zip code when you sign up or complete profile forms.
          </Paragraph>

          <SectionTitle>2. How IntelliWatt™ Uses Your Information</SectionTitle>
          <Paragraph>Your data allows us to:</Paragraph>
          <ul className="list-disc list-inside space-y-2 mb-4">
            <li>
              Analyze your electricity usage and compare plans available through our provider network to estimate savings.
            </li>
            <li>
              Calculate and manage entries in the{' '}
              <a
                href="https://www.hitthejackwatt.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-brand-blue underline decoration-transparent transition hover:decoration-brand-blue"
              >
                HitTheJackWatt™
              </a>{' '}
              monthly drawings.
            </li>
            <li>Notify you of drawing results, new ways to earn entries, or meaningful plan changes.</li>
            <li>Inform you of cost-saving energy opportunities, including solar or efficiency upgrades when available.</li>
            <li>Improve the IntelliWatt™ experience using aggregated, de-identified insights.</li>
          </ul>

          <SectionTitle>3. Sharing of Information</SectionTitle>
          <Paragraph>
            IntelliWatt™ does <strong>not</strong> sell or share personal information with third parties for marketing
            purposes. We share data only with trusted service providers necessary to operate the platform (for example,
            secure payment processors, WattBuy, or retail electric providers), and always under contractual privacy
            protections.
          </Paragraph>

          <SectionTitle>4. Data Retention</SectionTitle>
          <Paragraph>
            IntelliWatt™ retains your data only as long as needed to operate the program and meet applicable legal or
            regulatory requirements.
          </Paragraph>

          <SectionTitle>5. Your Choices</SectionTitle>
          <Paragraph>
            You may opt out of non-essential communications, request deletion of your account, or update your information
            at any time by contacting us at{' '}
            <a href="mailto:privacy@intelli-watt.com" className="text-brand-blue underline">
              privacy@intelli-watt.com
            </a>
            .
          </Paragraph>

          <SectionTitle>6. Security</SectionTitle>
          <Paragraph>
            IntelliWatt™ uses industry-standard administrative, technical, and physical safeguards—including encryption and
            role-based access controls—to protect your data from unauthorized access or disclosure.
          </Paragraph>

          <SectionTitle>7. Updates to This Policy</SectionTitle>
          <Paragraph>
            We may update this Privacy Policy periodically. Continued use of the site after changes are posted constitutes
            acceptance of the revised policy.
          </Paragraph>

          <SectionTitle>8. Contact Us</SectionTitle>
          <Paragraph>
            If you have questions or concerns about this Privacy Policy, or if you wish to revoke access to your data,
            please contact us at{' '}
            <a href="mailto:privacy@intelli-watt.com" className="text-brand-blue underline">
              privacy@intelli-watt.com
            </a>
            .
          </Paragraph>
          <Paragraph>
            <a href="https://www.intelli-watt.com" className="text-brand-blue underline">
              IntelliWatt™
            </a>{' '}
            is a registered DBA of{' '}
            <a href="https://www.intellipath-solutions.com" className="text-brand-blue underline">
              Intellipath Solutions LLC
            </a>
            .
          </Paragraph>
        </div>
      </main>
    </div>
  );
}

