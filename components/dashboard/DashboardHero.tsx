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
    <section className="bg-brand-navy px-4 py-6 sm:py-7 md:py-8">
      <div className="mx-auto max-w-4xl text-center space-y-3">
        {eyebrow ? (
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-brand-blue/70">
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
        <p className="mx-auto max-w-2xl text-base leading-relaxed text-brand-white/85">
          {description}
        </p>
        {children ? <div className="mt-4 flex justify-center">{children}</div> : null}
      </div>
    </section>
  );
}


