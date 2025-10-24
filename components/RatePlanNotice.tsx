import Link from "next/link";

type Props = {
  className?: string;
  ctaHref?: string;       // default: "/smt/authorize"
  ctaText?: string;       // default: "Authorize Smart Meter Texas"
  title?: string;         // default: "Rate Plan Analyzer: Coming Soon"
};

export default function RatePlanNotice({
  className = "",
  ctaHref = "/smt/authorize",
  ctaText = "Authorize Smart Meter Texas",
  title = "Rate Plan Analyzer: Coming Soon",
}: Props) {
  return (
    <div
      className={[
        "w-full rounded-2xl border border-yellow-300/60 bg-yellow-50 p-5 md:p-6",
        "shadow-sm ring-1 ring-yellow-200/60",
        className,
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-4">
        <div
          aria-hidden="true"
          className="mt-1 inline-flex h-9 w-9 flex-none items-center justify-center rounded-full bg-yellow-200 text-yellow-800"
          title="Information"
        >
          {/* info icon */}
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2zm0 14.75a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 1 1 1.5 0v4.5a.75.75 0 0 1-.75.75zm0-7.5a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75z"/>
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-yellow-900">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-yellow-900/90">
            The IntelliWatt Rate Plan Analyzer is in final testing. You can
            <span className="font-semibold"> authorize Smart Meter Texas now</span> so your usage data is securely
            linked and ready. While we finish connections and squash bugs, we won&rsquo;t show results in the dashboard yet.
            As soon as everything is live, we&rsquo;ll <span className="font-semibold">email your personalized plan recommendation</span>.
            Thanks for joining the early waitlist and helping us launch this the right way!
          </p>

          <div className="mt-4">
            <Link
              href={ctaHref}
              className="inline-flex items-center justify-center rounded-xl border border-yellow-700 bg-yellow-700 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-800 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2"
            >
              {ctaText}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/*
Example usage (if your dashboard file differs):
import RatePlanNotice from "@/components/RatePlanNotice";

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-5xl p-4 md:p-8">
      <RatePlanNotice className="mb-6" />
      // ...rest of dashboard...
    </main>
  );
}
*/
