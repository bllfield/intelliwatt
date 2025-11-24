export default function ProfilePage() {
  return (
    <div className="min-h-[60vh] bg-brand-white py-12 px-4">
      <div className="mx-auto max-w-4xl rounded-2xl border border-brand-navy shadow-lg bg-white p-8 text-center">
        <h1 className="text-3xl font-bold text-brand-navy mb-4">Profile</h1>
        <p className="text-brand-navy/80 mb-6">
          Update your personal details, contact information, and communication preferences. This portal
          will let you keep everything in IntelliWatt up to date.
        </p>
        <div className="rounded-xl border border-brand-navy/20 bg-brand-navy/5 p-6 text-brand-navy">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-blue mb-2">Coming Soon</p>
          <p className="text-brand-navy">We’re building a full profile manager so you can edit your info and manage notifications.</p>
        </div>
      </div>
    </div>
  );
}
