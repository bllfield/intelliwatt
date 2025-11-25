import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Security & Data Protection | IntelliWatt™',
  description:
    'Learn how IntelliWatt™ protects your account, handles usage data, and keeps your information secure.',
};

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95 text-brand-white">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-bold text-brand-blue">Security &amp; Data Protection</h1>
          <p className="mt-4 text-lg text-brand-white/80">
            IntelliWatt™ is built to lower your electricity costs without putting your personal information at risk.
            Here is how we authenticate accounts, what we collect, and the safeguards we use to protect your data.
          </p>
        </header>

        <section className="mb-10 rounded-2xl border border-brand-blue/20 bg-brand-navy/50 p-6 backdrop-blur-sm">
          <h2 className="text-2xl font-semibold text-brand-blue mb-3">Secure, Passwordless Access</h2>
          <p className="mb-3">
            IntelliWatt™ uses passwordless magic links instead of traditional usernames and passwords. Enter your email, and
            we send a one-time, time-limited link to that inbox. Clicking the link securely signs you in.
          </p>
          <p className="mb-3">
            Because we never store a password for your account, there is no password database for attackers to steal or reuse
            elsewhere. Your verified email inbox acts as the key to your IntelliWatt™ account.
          </p>
          <p>
            For your safety, do not share or forward your magic links. If you ever receive a sign-in email you did not request,
            you can safely ignore it or contact our team at <strong>support@intelliwatt.com</strong>.
          </p>
        </section>

        <section className="mb-10 rounded-2xl border border-brand-blue/20 bg-brand-navy/50 p-6 backdrop-blur-sm">
          <h2 className="text-2xl font-semibold text-brand-blue mb-3">What We Do and Do Not Store</h2>
          <p className="mb-3">
            We collect only the details needed to analyze your usage, recommend better plans, and manage your entries. In
            practice:
          </p>
          <ul className="mb-3 space-y-2 text-brand-white/90 list-disc list-inside">
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
          <p>
            Our goal is to work with your usage patterns and home data—not with sensitive financial or government ID
            information.
          </p>
        </section>

        <section className="mb-10 rounded-2xl border border-brand-blue/20 bg-brand-navy/50 p-6 backdrop-blur-sm">
          <h2 className="text-2xl font-semibold text-brand-blue mb-3">How We Use Your Energy Data</h2>
          <p className="mb-3">
            When you connect Smart Meter Texas, upload a bill, or link supported devices, IntelliWatt™ uses that information to
            understand how your home truly uses energy. This enables us to:
          </p>
          <ul className="mb-3 space-y-2 text-brand-white/90 list-disc list-inside">
            <li>Analyze real usage patterns over time—by season, by time of day, and by total consumption.</li>
            <li>Compare plans from our provider network and estimate what each plan would cost based on your data.</li>
            <li>Identify savings opportunities, including efficiency upgrades and optional solar or storage pathways.</li>
            <li>Track and manage your entries in the HitTheJackWatt™ drawings.</li>
          </ul>
          <p>
            We do <strong>not</strong> sell personal information or electricity usage data to data brokers. Any aggregate
            analysis we perform to improve IntelliWatt™ is de-identified so it cannot reasonably be linked back to you.
          </p>
        </section>

        <section className="mb-10 rounded-2xl border border-brand-blue/20 bg-brand-navy/50 p-6 backdrop-blur-sm">
          <h2 className="text-2xl font-semibold text-brand-blue mb-3">Protecting Your Information</h2>
          <p className="mb-3">
            All access to the IntelliWatt™ portal uses HTTPS to encrypt data in transit. Within our infrastructure, we follow
            industry-standard practices to protect data at rest and limit access to systems and team members who need it to run
            the service.
          </p>
          <p>
            We monitor for unusual activity, apply security updates, and continually invest in tooling and controls so your
            information stays protected while you receive clear, helpful insights.
          </p>
        </section>

        <section className="mb-10 rounded-2xl border border-brand-blue/20 bg-brand-navy/50 p-6 backdrop-blur-sm">
          <h2 className="text-2xl font-semibold text-brand-blue mb-3">Third-Party Connections</h2>
          <p className="mb-3">
            IntelliWatt™ connects to third-party data sources—such as Smart Meter Texas or supported smart-home integrations—only
            when you explicitly authorize them. You always stay in control of those connections.
          </p>
          <p>
            If you revoke access through a provider or disconnect a device, IntelliWatt™ stops pulling new data from that source.
            Need help managing a connection? Email <strong>support@intelliwatt.com</strong> and we will assist.
          </p>
        </section>

        <section className="rounded-2xl border border-brand-blue/20 bg-brand-navy/50 p-6 backdrop-blur-sm">
          <h2 className="text-2xl font-semibold text-brand-blue mb-3">Questions or Security Concerns?</h2>
          <p className="mb-3">
            If you notice something unfamiliar in your account or have questions about how your data is handled, please reach out.
            We take every security report seriously.
          </p>
          <p>
            Email <strong>support@intelliwatt.com</strong> and our team will review your request and respond as quickly as
            possible.
          </p>
        </section>
      </div>
    </div>
  );
}

