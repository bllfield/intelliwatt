'use client';

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type RepSearchBoxProps = {
  initialValue: string;
};

export function RepSearchBox({ initialValue }: RepSearchBoxProps) {
  const [value, setValue] = useState(initialValue);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const triggerSubmit = (nextValue: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      startTransition(() => {
        const params = new URLSearchParams(Array.from(searchParams?.entries?.() ?? []));

        if (nextValue) {
          params.set("search", nextValue);
        } else {
          params.delete("search");
        }

        const queryString = params.toString();
        const basePath = pathname ?? "";
        const target = queryString ? `${basePath}?${queryString}` : basePath;
        router.replace(target, { scroll: false });
      });
    }, 300);
  };

  return (
    <form
      method="get"
      className="flex flex-col gap-4 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        triggerSubmit(value);
      }}
    >
      <div className="flex-1">
        <label className="block text-sm font-medium text-brand-navy mb-2" htmlFor="rep-search-input">
          Search by PUCT number, legal name, or DBA
        </label>
        <input
          id="rep-search-input"
          name="search"
          value={value}
          placeholder="e.g. 10004 or Just Energy"
          onChange={(event) => {
            const next = event.target.value;
            setValue(next);
            triggerSubmit(next);
          }}
          className="w-full rounded-md border border-brand-blue/30 px-3 py-2 text-sm text-brand-navy shadow-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="inline-flex items-center rounded-md border border-brand-blue bg-brand-blue/10 px-4 py-2 text-sm font-medium text-brand-navy transition hover:bg-brand-blue/20"
        >
          Search
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => {
              setValue("");
              triggerSubmit("");
            }}
            className="inline-flex items-center rounded-md border border-brand-blue/40 bg-brand-blue/5 px-3 py-2 text-sm text-brand-navy transition hover:bg-brand-blue/10"
          >
            Clear
          </button>
        ) : null}
      </div>
    </form>
  );
}

