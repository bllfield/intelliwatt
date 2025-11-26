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
    <section className="px-4 py-6 sm:py-7 md:py-8">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy/95 px-6 py-7 text-center text-brand-white shadow-[0_24px_70px_rgba(16,46,90,0.4)] sm:px-8">
          <div className="space-y-3">
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
            <p className="mx-auto max-w-2xl text-sm sm:text-base leading-relaxed text-brand-white/85">
              {description}
            </p>
            {children ? <div className="pt-2 flex justify-center">{children}</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}


