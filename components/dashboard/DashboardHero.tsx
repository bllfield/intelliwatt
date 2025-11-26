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
    <section className="bg-brand-navy px-4 py-8 sm:py-9 md:py-10 border-b border-brand-blue/20">
      <div className="mx-auto max-w-4xl text-center space-y-4">
        {eyebrow ? (
          <div className="inline-flex rounded-full border border-brand-blue/30 bg-brand-blue/10 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-brand-blue/80">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-3xl font-semibold text-brand-white sm:text-4xl">
          {title}
          {highlight ? (
            <>
              {' '}
              <span className="text-brand-blue">{highlight}</span>
            </>
          ) : null}
        </h1>
        <p className="mx-auto max-w-2xl text-lg leading-relaxed text-brand-white/90">
          {description}
        </p>
        {children ? <div className="mt-6 flex justify-center">{children}</div> : null}
      </div>
    </section>
  );
}


