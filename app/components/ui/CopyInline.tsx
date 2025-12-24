"use client";

import { useState } from "react";

export function CopyInline(props: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const label = props.label ?? "Copy";

  return (
    <button
      type="button"
      className="rounded-full border border-brand-blue/30 bg-brand-blue/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-blue hover:bg-brand-blue/20"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          // ignore
        }
      }}
      title="Copy to clipboard"
    >
      {copied ? "Copied" : label}
    </button>
  );
}


