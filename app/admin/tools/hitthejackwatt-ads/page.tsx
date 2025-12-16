"use client";

import { useCallback, useRef, useState } from "react";

type AdOption = {
  id: string;
  title: string;
  description: string;
  imageSrc: string;
  alt: string;
  caption: string;
  downloadName: string;
};

export default function HitTheJackWattSocialAdsPage() {
  const [copiedAdId, setCopiedAdId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopyAdCaption = useCallback(async (adId: string, caption: string) => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopiedAdId(adId);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopiedAdId(null), 2000);
    } catch {
      // ignore
    }
  }, []);

  const adOptions: AdOption[] = [
    {
      id: "jackpot-charge",
      title: "Jackpot Jumpstart",
      description:
        "Hero-ready neon tile that mirrors the HitTheJackWatt landing gradient and spotlights the instant jackpot promise.",
      imageSrc: "/ads/hitthejackwatt/ad-jackpot-charge.svg",
      alt: "HitTheJackWatt jackpot jumpstart tile with neon magenta headline over deep purple gradient.",
      caption: [
        "🎰 HitTheJackWatt™ Jackpot Jumpstart",
        "Slash your energy bill and stay in every monthly drawing with verified Smart Meter Texas data.",
        "Authorize once, let IntelliWatt monitor usage, and watch jackpot entries stack automatically.",
        "Claim your dashboard: https://www.hitthejackwatt.com",
      ].join("\n"),
      downloadName: "HitTheJackWatt-Jackpot-Jumpstart.svg",
    },
    {
      id: "smart-meter-surge",
      title: "Smart Meter Autopilot",
      description:
        "Cyan-forward automation tile designed to promote the “connect once, stay verified” SMT workflow.",
      imageSrc: "/ads/hitthejackwatt/ad-smart-meter-surge.svg",
      alt: "HitTheJackWatt smart meter autopilot tile with cyan waveform accents.",
      caption: [
        "⚡ HitTheJackWatt™ Smart Meter Autopilot",
        "Connect Smart Meter Texas once—IntelliWatt pulls verified intervals daily and keeps entries active.",
        "Track live usage, savings alerts, and jackpot progress without manual uploads.",
        "Sync now and automate your energy dashboard: https://www.hitthejackwatt.com",
      ].join("\n"),
      downloadName: "HitTheJackWatt-Smart-Meter-Autopilot.svg",
    },
    {
      id: "referral-rush",
      title: "Referral Power-Up",
      description:
        "Referral-forward magenta tile aligned with the landing page CTA bars for ambassador sharing.",
      imageSrc: "/ads/hitthejackwatt/ad-referral-rush.svg",
      alt: "HitTheJackWatt referral power-up tile with neon magenta and green glow.",
      caption: [
        "🤝 HitTheJackWatt™ Referral Power-Up",
        "Invite friends, earn double entries once their usage is verified—no manual chasing.",
        "We send reminders, log progress, and surface payouts in your IntelliWatt referral hub.",
        "Share your jackpot link: https://www.hitthejackwatt.com",
      ].join("\n"),
      downloadName: "HitTheJackWatt-Referral-Power-Up.svg",
    },
    {
      id: "savings-snapshot",
      title: "Savings Radar",
      description:
        "Data-forward cyan tile that echoes the IntelliWatt analytics sections with neon radar accents.",
      imageSrc: "/ads/hitthejackwatt/ad-savings-snapshot.svg",
      alt: "HitTheJackWatt savings radar tile with cyan mesh background and neon headline.",
      caption: [
        "📊 HitTheJackWatt™ Savings Radar",
        "Upload a bill for baseline insights, then automate SMT pulls for precision savings tracking.",
        "Compare your current contract against curated Texas plans while banking jackpot entries.",
        "Open your IntelliWatt dashboard: https://www.hitthejackwatt.com",
      ].join("\n"),
      downloadName: "HitTheJackWatt-Savings-Radar.svg",
    },
  ];

  return (
    <div className="min-h-screen bg-brand-navy">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <section className="bg-brand-white rounded-lg p-6 shadow-lg">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold text-brand-navy mb-2">🎯 HitTheJackWatt Social Ads</h1>
              <p className="text-sm text-brand-navy/70">
                Download ready-to-share square creatives or copy the suggested caption. Each tile keeps brand colors on-brand
                for the HitTheJackWatt jackpot campaign and pairs cleanly with referral links or paid ads.
              </p>
            </div>
            <a
              href="https://www.hitthejackwatt.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 self-start rounded-full border border-brand-blue/30 bg-brand-blue/10 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue hover:bg-brand-blue/20"
            >
              View landing site
            </a>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {adOptions.map((ad) => (
              <article
                key={ad.id}
                className="flex h-full flex-col rounded-2xl border border-brand-navy/10 bg-brand-navy/5 p-4"
              >
                <div className="relative overflow-hidden rounded-xl bg-brand-navy shadow-inner">
                  <img
                    src={ad.imageSrc}
                    alt={ad.alt}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="mt-4 flex flex-col gap-3 text-brand-navy">
                  <div>
                    <h2 className="text-lg font-semibold text-brand-navy">{ad.title}</h2>
                    <p className="mt-1 text-sm text-brand-navy/70">{ad.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void handleCopyAdCaption(ad.id, ad.caption)}
                      className="inline-flex items-center gap-2 rounded-full border border-brand-blue/30 bg-brand-blue/10 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue hover:bg-brand-blue/20"
                    >
                      {copiedAdId === ad.id ? "Caption copied!" : "Copy caption"}
                    </button>
                    <a
                      href={ad.imageSrc}
                      download={ad.downloadName}
                      className="inline-flex items-center gap-2 rounded-full border border-brand-navy/20 bg-brand-white px-4 py-2 text-sm font-semibold uppercase tracking-wide text-brand-navy shadow-sm transition hover:border-brand-blue/40 hover:text-brand-blue"
                    >
                      Download SVG
                    </a>
                  </div>
                </div>
                <span className="sr-only" aria-live="polite">
                  {copiedAdId === ad.id ? "Caption copied to clipboard" : ""}
                </span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}


