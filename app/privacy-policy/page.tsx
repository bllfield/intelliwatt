import React from "react";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
      </div>

      <main className="relative max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-4xl font-bold mb-6 text-brand-blue">Privacy Policy</h1>

        <div className="bg-gradient-to-br from-brand-blue/5 to-brand-cyan/10 p-8 rounded-2xl border border-brand-blue/10 backdrop-blur-sm">
          <p className="mb-4 text-brand-white">
            At IntelliWatt, your privacy is important to us. This Privacy Policy explains how we collect, use, and protect your information—especially when using Smart Meter Texas (SMT) data to provide energy optimization and plan recommendations.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4 text-brand-blue">1. Information We Collect</h2>
          <p className="mb-4 text-brand-white">
            With your explicit consent, IntelliWatt may collect smart meter data from Smart Meter Texas (SMT), including your ESIID, 15-minute usage history, meter reads, and related energy attributes. We may also collect your name, address, phone number, and email for account verification and energy plan matching.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4 text-brand-blue">2. How We Use Your Data</h2>
          <p className="mb-4 text-brand-white">
            Your energy data is used to:
          </p>
          <ul className="list-disc list-inside mb-4 text-brand-white">
            <li>Monitor your electricity usage patterns</li>
            <li>Recommend lower-cost energy plans</li>
            <li>Simulate solar and battery solutions</li>
            <li>Evaluate home efficiency opportunities</li>
          </ul>

          <h2 className="text-2xl font-semibold mt-8 mb-4 text-brand-blue">3. Customer Consent & Authorization</h2>
          <p className="mb-4 text-brand-white">
            Access to your Smart Meter Texas data is only granted after you provide explicit authorization. You may revoke this access at any time by contacting us at <a href="mailto:support@intelliwatt.com" className="text-brand-blue underline hover:text-brand-cyan transition-colors duration-200">support@intelliwatt.com</a>.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4 text-brand-blue">4. Data Sharing</h2>
          <p className="mb-4 text-brand-white">
            We do not sell or rent your data. We may share it only with partners who help us analyze energy usage, simulate solar systems, or facilitate plan switching—with strict contractual requirements to protect your information.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4 text-brand-blue">5. Security Practices</h2>
          <p className="mb-4 text-brand-white">
            We use encryption, role-based access controls, and secure data storage to protect your information. Access to SMT and customer data is limited to authorized personnel only.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4 text-brand-blue">6. Your Rights</h2>
          <p className="mb-4 text-brand-white">
            You can:
          </p>
          <ul className="list-disc list-inside mb-4 text-brand-white">
            <li>Revoke consent to access your SMT data</li>
            <li>Request deletion of your account and associated data</li>
            <li>Update your contact or energy plan info at any time</li>
          </ul>

          <h2 className="text-2xl font-semibold mt-8 mb-4 text-brand-blue">7. Contact Us</h2>
          <p className="mb-4 text-brand-white">
            If you have any questions about this Privacy Policy, or if you wish to revoke access to your data, please contact us at:
          </p>
          <p className="mb-4 text-brand-white">
            <strong>Email:</strong>{" "}
            <a href="mailto:support@intelliwatt.com" className="text-brand-blue underline hover:text-brand-cyan transition-colors duration-200">
              support@intelliwatt.com
            </a>
          </p>
        </div>
      </main>
    </div>
  );
} 