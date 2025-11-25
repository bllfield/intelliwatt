import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Security & Data Protection | IntelliWatt™',
  description:
    'Learn how IntelliWatt™ protects your account, handles usage data, and keeps your information secure.',
};

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

const contentSections: Array<{ title: string; body: ReactNode }> = [
  {
    title: 'Secure, Passwordless Access',
    body: (
      <div className="space-y-4 text-brand-white/90">
        <p>
          <Intelliwatt /> uses passwordless magic links instead of traditional usernames and passwords. Enter your email,
          and we send a one-time, time-limited link straight to that inbox. Clicking the link securely signs you in.
        </p>
        <p>
          Because we never store a password for your account, there is no password database for attackers to steal or
          reuse elsewhere. Your verified email inbox acts as the key to your <Intelliwatt /> account.
        </p>
        <p>
          For your safety, do not share or forward your magic links. If you ever receive a sign-in email you did not
          request, you can safely ignore it or contact our team at <strong>support@intelliwatt.com</strong>.
        </p>
      </div>
    ),
  },
  {
    title: 'What We Do and Do Not Store',
    body: (
      <div className="space-y-4 text-brand-white/90">
        <p>
          We collect only the details needed to analyze your usage, recommend better plans, and manage your entries. In
          practice:
        </p>
        <ul className="list-disc list-inside space-y-2 marker:text-[#39FF14] text-brand-white">
          <li>
            We <strong>do</strong> store your email and basic profile information so we can create your account, send magic
            links, and keep you informed about entries and plan recommendations.
          </li>
          <li>
            We <strong>do</strong> store the energy-related information you share—Smart Meter Texas usage data, uploaded
            bills, rate plans, home characteristics, and appliance details—to deliver accurate insights.
          </li>
          <li>
            We <strong>do not</strong> store highly sensitive data such as Social Security numbers, bank account numbers, or
            credit/debit card numbers.
          </li>
          <li>We do not ask for or store passwords to your financial or utility accounts.</li>
        </ul>
        <p>Our goal is to work with your usage patterns and home data—not with sensitive financial or government ID information.</p>
      </div>
    ),
  },
  {
    title: 'How We Use Your Energy Data',
    body: (
      <div className="space-y-4 text-brand-white/90">
        <p>
          When you connect Smart Meter Texas, upload a bill, or link supported devices, <Intelliwatt /> uses that
          information to understand how your home truly uses energy. This enables us to:
        </p>
        <ul className="list-disc list-inside space-y-2 marker:text-[#39FF14] text-brand-white">
          <li>Analyze real usage patterns over time—by season, by time of day, and by total consumption.</li>
          <li>Compare plans from our provider network and estimate what each plan would cost based on your data.</li>
          <li>Identify savings opportunities, including efficiency upgrades and optional solar or storage pathways.</li>
          <li>Track and manage your entries in the <HitTheJackWatt /> drawings.</li>
        </ul>
        <p>
          We do <strong>not</strong> sell personal information or electricity usage data to data brokers. Any aggregate
          analysis we perform to improve <Intelliwatt /> is de-identified so it cannot reasonably be linked back to you.
        </p>
      </div>
    ),
  },
  {
    title: 'Protecting Your Information',
    body: (
      <div className="space-y-4 text-brand-white/90">
        <p>
          All access to the <Intelliwatt /> portal uses HTTPS to encrypt data in transit. Within our infrastructure, we
          follow industry-standard practices to protect data at rest and limit access to systems and team members who need it
          to run the service.
        </p>
        <p>
          We monitor for unusual activity, apply security updates, and continually invest in tooling and controls so your
          information stays protected while you receive clear, helpful insights.
        </p>
      </div>
    ),
  },
  {
    title: 'Third-Party Connections',
    body: (
      <div className="space-y-4 text-brand-white/90">
        <p>
          <Intelliwatt /> connects to third-party data sources—such as Smart Meter Texas or supported smart-home integrations—only
          when you explicitly authorize them. You always stay in control of those connections.
        </p>
        <p>
          If you revoke access through a provider or disconnect a device, <Intelliwatt /> stops pulling new data from that
          source. Need help managing a connection? Email <strong>support@intelliwatt.com</strong> and we will assist.
        </p>
      </div>
    ),
  },
  {
    title: 'Questions or Security Concerns?',
    body: (
      <div className="space-y-4 text-brand-white/90">
        <p>
          If you notice something unfamiliar in your account or have questions about how your data is handled, please reach
          out. We take every security report seriously.
        </p>
        <p>
          Email <strong>support@intelliwatt.com</strong> and our team will review your request and respond as quickly as
          possible.
        </p>
        <p>
          <Intelliwatt /> is a service of <IntellipathLink />.
        </p>
      </div>
    ),
  },
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-brand-white">
      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,224,255,0.12),transparent_55%)]" />
        </div>
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-brand-white mb-6">
            Security &amp; Data Protection
          </h1>
          <p className="text-xl text-brand-white/90 leading-relaxed">
            <Intelliwatt /> is designed to cut your energy costs without putting your personal information at risk. Here is
            how we authenticate accounts, what we collect, and the safeguards that keep your data protected.
          </p>
        </div>
      </section>

      <section className="py-24 px-4 bg-brand-white">
        <div className="max-w-5xl mx-auto space-y-8">
          {contentSections.map(({ title, body }) => (
            <div
              key={title}
              className="bg-brand-navy p-8 rounded-2xl border border-brand-blue/40 shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
            >
              <h2 className="text-2xl font-bold text-[#00E0FF] mb-4">{title}</h2>
              {body}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

