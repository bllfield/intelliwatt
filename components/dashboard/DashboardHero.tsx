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
    <section className="relative bg-brand-navy px-4 py-12 sm:py-14 md:py-16 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.12),transparent_55%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl text-center">
        {eyebrow ? (
          <div className="mb-4 inline-flex rounded-full border border-brand-blue/40 bg-brand-blue/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] text-brand-blue/80">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-4xl font-bold text-brand-white md:text-6xl">
          {title}
          {highlight ? (
            <>
              {' '}
              <span className="text-brand-blue">{highlight}</span>
            </>
          ) : null}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-xl leading-relaxed text-brand-white">
          {description}
        </p>
        {children ? <div className="mt-8 flex justify-center">{children}</div> : null}
      </div>
    </section>
  );
}


