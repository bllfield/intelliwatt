import { ReactNode } from 'react';

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
    <section className="px-4 pt-4 pb-5 sm:pt-5 sm:pb-6">
      <div className="mx-auto max-w-5xl">
        <div className="relative">
          <div className="pointer-events-none absolute inset-[-18px] rounded-[2.75rem] bg-brand-blue/25 opacity-60 blur-3xl" />
          <div className="relative rounded-3xl border border-brand-cyan/40 bg-brand-navy px-5 py-6 text-center text-brand-white shadow-[0_18px_55px_rgba(16,46,90,0.32)] sm:px-7 sm:py-7">
            <div className="space-y-2.5">
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
              {children ? <div className="pt-1.5 flex justify-center">{children}</div> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


