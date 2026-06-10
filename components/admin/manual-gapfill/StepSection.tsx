import type { ReactNode } from "react";

export function StepSection(props: {
  step: number;
  title: string;
  description?: string;
  stale?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border bg-white p-4 ${
        props.stale ? "border-amber-300 bg-amber-50/40" : "border-slate-200"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-brand-navy">
            Step {props.step} — {props.title}
          </h2>
          {props.description ? <p className="mt-1 text-sm text-slate-600">{props.description}</p> : null}
        </div>
        {props.stale ? (
          <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
            Stale — re-run after ID/mode change
          </span>
        ) : null}
      </div>
      <div className="mt-4">{props.children}</div>
    </section>
  );
}

export function WarningsList({ warnings }: { warnings: string[] | undefined }) {
  if (!warnings?.length) return null;
  return (
    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}

export function JsonDetails({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">{label}</summary>
      <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <dl className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2">{children}</dl>;
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="font-semibold">{label}</dt>
      <dd className="break-all">{value ?? "—"}</dd>
    </div>
  );
}
