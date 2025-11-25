import type { ReactNode } from 'react';

const Intelliwatt = ({ children = 'IntelliWatt™' }: { children?: ReactNode }) => (
  <span className="font-semibold text-[#00E0FF] drop-shadow-[0_0_12px_rgba(0,224,255,0.8)]">{children}</span>
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
  <h2 className="text-2xl font-bold mt-8 mb-4 text-[#00E0FF]">{children}</h2>
);

const Paragraph = ({ children }: { children: ReactNode }) => (
  <p className="text-brand-white/90 leading-relaxed mb-4 text-lg">{children}</p>
);

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-brand-white">
      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,224,255,0.12),transparent_55%)]" />
        </div>
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-brand-white mb-4">Privacy Policy</h1>
          <p className="text-lg text-brand-white/80">Effective Date: May 17, 2025</p>
          <p className="mt-6 text-xl text-brand-white/90 leading-relaxed">
            <Intelliwatt /> is built to save you money—not guess about your bill. This policy explains how we collect, use,
            and safeguard information for both <Intelliwatt /> and the <HitTheJackWatt /> rewards program.
          </p>
        </div>
      </section>

      <section className="py-24 px-4 bg-brand-white">
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="bg-brand-navy p-8 rounded-2xl border border-brand-blue/40 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
            <Paragraph>
              To recommend the right electricity plan for <em>your</em> home, we need the same information every provider,
              broker, or advisor requires: your real usage data. The more accurate your usage data, the better <Intelliwatt />
              can analyze your real costs.
            </Paragraph>

            <SectionTitle>How We Use Your Electricity Usage Data</SectionTitle>
            <Paragraph>
              Every home is unique. When you share usage data with us, our systems can understand details such as:
            </Paragraph>
            <ul className="list-disc list-inside space-y-2 mb-4 text-brand-white marker:text-[#39FF14]">
              <li>How much power you use during the day versus at night</li>
              <li>Seasonal swings and shoulder-month usage changes</li>
              <li>The share of your bill driven by HVAC or other large systems</li>
              <li>How much energy you use during peak vs. off-peak hours</li>
              <li>Whether “free nights,” “free weekends,” solar buyback, or other plan types could save you money</li>
            </ul>
            <Paragraph>
              We compare your usage against plans available through our growing provider network—starting with WattBuy—to
              estimate what each plan would have cost you. Then we highlight the lowest-priced options for your specific pattern.
            </Paragraph>
            <Paragraph>
              Without usage data, <Intelliwatt /> can’t run the full analysis engine. Sharing your usage allows us to do real
              math on your situation instead of relying on generic averages.
            </Paragraph>
            <Paragraph>You can provide your usage in two primary ways:</Paragraph>
            <ul className="list-disc list-inside space-y-2 mb-4 text-brand-white marker:text-[#39FF14]">
              <li>
                <strong>Smart Meter Texas (SMT):</strong> Connect your account so we can securely access your interval data.
              </li>
              <li>
                <strong>Manual upload:</strong> Upload a bill, CSV, or Green Button file with your usage history.
              </li>
            </ul>
            <Paragraph>
              To keep results and profile-based entries active, we recommend keeping at least the most recent 12 months of usage
              data on file.
            </Paragraph>

            <SectionTitle>Data Sharing and Privacy</SectionTitle>
            <Paragraph>
              We take your privacy seriously. Here is how we handle your electricity usage data in connection with <Intelliwatt />
              and the <HitTheJackWatt /> program:
            </Paragraph>
            <ul className="list-disc list-inside space-y-2 mb-4 text-brand-white marker:text-[#39FF14]">
              <li>
                <strong>No sale of personal data:</strong> We do not sell or rent your personal information or individual
                usage data to third-party marketers.
              </li>
              <li>
                <strong>Service use only:</strong> Usage data is used to analyze bills, recommend plans, estimate savings, and
                operate <Intelliwatt /> features.
              </li>
              <li>
                <strong>Aggregated analysis:</strong> We may combine your data with others in aggregated, de-identified form to
                improve our models. Those aggregates cannot reasonably be traced back to you.
              </li>
              <li>
                <strong>Limited partner sharing:</strong> When needed to deliver the service (e.g., to compare plans or facilitate
                a switch), we share limited information with trusted partners under strict contractual controls.
              </li>
              <li>
                <strong>Your control:</strong> You may revoke SMT access or request deletion of your account and associated data
                (subject to legal retention requirements) by contacting us.
              </li>
            </ul>

            <SectionTitle>1. Information <Intelliwatt /> Collects</SectionTitle>
            <Paragraph>
              With your consent, <Intelliwatt /> may collect Smart Meter Texas interval data, manual usage uploads, and details
              you provide about your home and household. We also collect account information such as name, email, phone number,
              and zip code when you sign up or complete profile forms.
            </Paragraph>

            <SectionTitle>2. How <Intelliwatt /> Uses Your Information</SectionTitle>
            <Paragraph>Your data allows us to:</Paragraph>
            <ul className="list-disc list-inside space-y-2 mb-4 text-brand-white marker:text-[#39FF14]">
              <li>Analyze your electricity usage and compare plans available through our provider network to estimate savings.</li>
              <li>
                Calculate and manage entries in the <HitTheJackWatt /> monthly drawings.
              </li>
              <li>Notify you of drawing results, new ways to earn entries, or meaningful plan changes.</li>
              <li>Inform you of cost-saving energy opportunities, including solar or efficiency upgrades when available.</li>
              <li>Improve the <Intelliwatt /> experience using aggregated, de-identified insights.</li>
            </ul>

            <SectionTitle>3. Sharing of Information</SectionTitle>
            <Paragraph>
              <Intelliwatt /> does <strong>not</strong> sell or share personal information with third parties for marketing
              purposes. We share data only with trusted service providers necessary to operate the platform (for example, secure
              payment processors, WattBuy, or retail electric providers) and always under contractual privacy protections.
            </Paragraph>

            <SectionTitle>4. Data Retention</SectionTitle>
            <Paragraph>
              <Intelliwatt /> retains your data only as long as needed to operate the program and meet applicable legal or
              regulatory requirements.
            </Paragraph>

            <SectionTitle>5. Your Choices</SectionTitle>
            <Paragraph>
              You may opt out of non-essential communications, request deletion of your account, or update your information at
              any time by contacting us at{' '}
              <a href="mailto:privacy@intelli-watt.com" className="font-semibold text-[#00E0FF] underline">
                privacy@intelli-watt.com
              </a>
              .
            </Paragraph>

            <SectionTitle>6. Security</SectionTitle>
            <Paragraph>
              <Intelliwatt /> uses industry-standard administrative, technical, and physical safeguards—including encryption and
              role-based access controls—to protect your data from unauthorized access or disclosure.
            </Paragraph>

            <SectionTitle>7. Updates to This Policy</SectionTitle>
            <Paragraph>
              We may update this Privacy Policy periodically. Continued use of the site after changes are posted constitutes
              acceptance of the revised policy.
            </Paragraph>

            <SectionTitle>8. Contact Us</SectionTitle>
            <Paragraph>
              If you have questions or concerns about this Privacy Policy, or if you wish to revoke access to your data, contact
              us at{' '}
              <a href="mailto:privacy@intelli-watt.com" className="font-semibold text-[#00E0FF] underline">
                privacy@intelli-watt.com
              </a>
              .
            </Paragraph>
            <Paragraph>
              <Intelliwatt /> is a registered DBA of <IntellipathLink />.
            </Paragraph>
          </div>
        </div>
      </section>
    </div>
  );
}

