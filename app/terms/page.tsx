import type { ReactNode } from 'react';

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h2 className="text-2xl font-semibold mt-10 mb-4 text-brand-blue">{children}</h2>
);

const Paragraph = ({ children }: { children: ReactNode }) => (
  <p className="text-brand-white leading-relaxed mb-4">{children}</p>
);

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy relative overflow-hidden">
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
      </div>

      <main className="relative max-w-4xl mx-auto px-6 py-12 space-y-6">
        <h1 className="text-4xl font-bold text-brand-blue">Terms of Service</h1>
        <p className="text-brand-white font-semibold">Effective Date: May 17, 2025</p>

        <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 p-8 rounded-2xl border border-brand-blue/10 backdrop-blur-sm text-brand-white">
          <SectionTitle>1. Acceptance of Terms</SectionTitle>
          <Paragraph>
            By accessing or using{' '}
            <a
              href="https://www.hitthejackwatt.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand-blue underline decoration-transparent transition hover:decoration-brand-blue"
            >
              HitTheJackWatt™.com
            </a>{' '}
            or the IntelliWatt™ portal, you agree to be bound by these Terms of Service and our Privacy Policy. If you do not
            agree, please do not use the website or related services.
          </Paragraph>

          <SectionTitle>2. Use of the Site</SectionTitle>
          <Paragraph>
            You may use this site for personal, non-commercial purposes only. You agree not to misuse the platform or
            engage in fraudulent, harmful, or disruptive activities, and to provide accurate information when requested.
          </Paragraph>

          <SectionTitle>3. Entries and Eligibility</SectionTitle>
          <Paragraph>
            Participation in the{' '}
            <a
              href="https://www.hitthejackwatt.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand-blue underline decoration-transparent transition hover:decoration-brand-blue"
            >
              HitTheJackWatt™
            </a>{' '}
            drawing system is governed by the{' '}
            <a href="/rules" className="text-brand-blue underline">
              Official Rules
            </a>
            . No purchase, payment, or plan switch is required to enter or win. Usage-based and profile-based entries
            remain active while IntelliWatt™ has usage data from the preceding twelve (12) months. Referral, testimonial,
            and AMOE entries do not expire unless your account becomes ineligible.
          </Paragraph>

          <SectionTitle>4. Account Responsibility</SectionTitle>
          <Paragraph>
            You are responsible for maintaining the confidentiality of your account credentials and for all activity under
            your account. Notify us immediately if you suspect unauthorized use.
          </Paragraph>

          <SectionTitle>5. Intellectual Property</SectionTitle>
          <Paragraph>
            All content on this site—including text, graphics, logos, and software—is the property of{' '}
            <a href="https://www.intellipath-solutions.com" className="text-brand-blue underline">
              Intellipath Solutions LLC
            </a>{' '}
            and is protected by applicable intellectual property laws. You may not reproduce or reuse this content without
            permission.
          </Paragraph>

          <SectionTitle>6. Termination</SectionTitle>
          <Paragraph>
            We reserve the right to suspend or terminate access to your account or participation in the drawing system at
            our discretion, including for violations of these terms or suspected fraudulent activity.
          </Paragraph>

          <SectionTitle>7. Disclaimers</SectionTitle>
          <Paragraph>
            This site and its services are provided “as is” without warranties of any kind. We do not guarantee
            uninterrupted access, error-free operation, or that any particular outcome—including prize winnings—is
            guaranteed.
          </Paragraph>

          <SectionTitle>8. Limitation of Liability</SectionTitle>
          <Paragraph>
            In no event shall{' '}
            <a href="https://www.intellipath-solutions.com" className="text-brand-blue underline">
              Intellipath Solutions LLC
            </a>{' '}
            be liable for any indirect, incidental, special, or consequential damages arising from your use of the site or
            participation in any drawings.
          </Paragraph>

          <SectionTitle>9. Changes to Terms</SectionTitle>
          <Paragraph>
            We may update these Terms of Service at any time. Continued use of the site after updates means you accept the
            revised terms.
          </Paragraph>

          <SectionTitle>10. Contact Us</SectionTitle>
          <Paragraph>
            If you have questions or concerns about these Terms of Service, please contact us at{' '}
            <a href="mailto:support@intelli-watt.com" className="text-brand-blue underline">
              support@intelli-watt.com
            </a>
            . IntelliWatt™ is a registered DBA of{' '}
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

