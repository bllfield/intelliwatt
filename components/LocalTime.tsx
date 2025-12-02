'use client';

import { useMemo } from 'react';

type LocalTimeProps = {
  value: string | number | Date | null | undefined;
  options?: Intl.DateTimeFormatOptions;
  fallback?: React.ReactNode;
  className?: string;
};

const DEFAULT_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

type FormattedResult = {
  iso: string;
  text: string;
};

export default function LocalTime({
  value,
  options,
  fallback = '—',
  className,
}: LocalTimeProps) {
  const optionsKey = useMemo(
    () => (options ? JSON.stringify(options) : JSON.stringify(DEFAULT_FORMAT_OPTIONS)),
    [options],
  );

  const formatted: FormattedResult | null = useMemo(() => {
    if (value === null || value === undefined) {
      return null;
    }

    const dateValue = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dateValue.getTime())) {
      return null;
    }

    const formatterOptions = options ?? DEFAULT_FORMAT_OPTIONS;
    const formatter = new Intl.DateTimeFormat(undefined, formatterOptions);

    return {
      iso: dateValue.toISOString(),
      text: formatter.format(dateValue),
    };
  }, [value, optionsKey, options]);

  if (!formatted) {
    if (fallback === null || fallback === undefined) {
      return null;
    }
    if (typeof fallback === 'string' || typeof fallback === 'number') {
      return <span className={className}>{fallback}</span>;
    }
    return <>{fallback}</>;
  }

  return (
    <time className={className} dateTime={formatted.iso} suppressHydrationWarning>
      {formatted.text}
    </time>
  );
}


