'use client';

import { useEffect, useRef, useState } from "react";

type RepSearchBoxProps = {
  initialValue: string;
};

export function RepSearchBox({ initialValue }: RepSearchBoxProps) {
  const [value, setValue] = useState(initialValue);
  const formRef = useRef<HTMLFormElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const triggerSubmit = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      formRef.current?.requestSubmit();
    }, 300);
  };

  return (
    <form
      ref={formRef}
      method="get"
      className="flex flex-col gap-4 sm:flex-row sm:items-end"
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
            setValue(event.target.value);
            triggerSubmit();
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
              triggerSubmit();
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

