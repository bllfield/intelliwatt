import { ReactNode } from 'react';
import IntelliwattBotHero from '@/components/dashboard/IntelliwattBotHero';

type DashboardHeroProps = {
  title: string;
  highlight?: string;
  description: string;
  eyebrow?: string;
  children?: ReactNode;
};

export default function DashboardHero({
  title,
  highlight,
  description,
  eyebrow,
  children,
}: DashboardHeroProps) {
  return (
    <section className="px-4 pt-2 pb-4 sm:pt-3 sm:pb-5">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy px-5 py-5 text-center text-brand-white shadow-[0_16px_45px_rgba(16,46,90,0.25)] sm:px-7 sm:py-6">
          <div className="space-y-2">
            {eyebrow ? (
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.32em] text-brand-cyan/70">
                {eyebrow}
              </p>
            ) : null}
            <h1 className="text-3xl font-semibold text-brand-white sm:text-[2.35rem]">
              {title}
              {highlight ? (
                <>
                  {' '}
                  <span className="text-brand-blue">{highlight}</span>
                </>
              ) : null}
            </h1>
            <p className="mx-auto max-w-2xl text-sm leading-relaxed text-brand-white/85 sm:text-base">
              {description}
            </p>
            {children ? <div className="pt-1 flex justify-center">{children}</div> : null}
          </div>
        </div>

        {/* IntelliWattBot appears right below the page title section */}
        <div className="mt-4">
          <IntelliwattBotHero />
        </div>
      </div>
    </section>
  );
}


