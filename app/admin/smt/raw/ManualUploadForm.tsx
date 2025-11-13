"use client";

import { useFormState } from "react-dom";
import { useMemo } from "react";
import { useFormStatus } from "react-dom";

export type UploadFormState = {
  ok: boolean | null;
  message?: string;
  error?: string;
};

const initialState: UploadFormState = { ok: null };

type ManualUploadFormProps = {
  action: (state: UploadFormState, formData: FormData) => Promise<UploadFormState>;
};

export default function ManualUploadForm({ action }: ManualUploadFormProps) {
  const [state, formAction] = useFormState(action, initialState);
  const alertClasses = useMemo(() => {
    if (state.ok === null) return "hidden";
    if (state.ok) {
      return "rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800";
    }
    return "rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700";
  }, [state.ok]);

  return (
    <section className="max-w-6xl mx-auto p-6 space-y-4 border border-gray-200 rounded-lg bg-white shadow-sm">
      <header>
        <h1 className="text-2xl font-semibold">Manual SMT CSV Upload</h1>
        <p className="text-sm text-gray-600 mt-1">
          Upload an SMT-style CSV to persist it as a RawSmtFile and immediately normalize it into{" "}
          <code>SmtInterval</code>. Files are posted inline via <code>/api/admin/smt/pull</code> and then normalized.
        </p>
      </header>

      <form action={formAction} encType="multipart/form-data" className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">SMT CSV file</label>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            Expected format: interval CSV matching SMT <code>adhocusage</code> layout (same as droplet uploads).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-sm font-medium text-gray-700">
            ESIID (optional)
            <input
              type="text"
              name="esiid"
              defaultValue="10443720000000001"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Meter (optional)
            <input
              type="text"
              name="meter"
              defaultValue="M1"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <SubmitButton />
          <p className="text-xs text-gray-500">
            After success, click “Load Raw Files” below to refresh the table and confirm ingestion.
          </p>
        </div>
      </form>

      <div className={alertClasses} role="status">
        {state.ok ? (
          <p>
            <strong>Success:</strong> {state.message}
          </p>
        ) : (
          state.error && (
            <p>
              <strong>Error:</strong> {state.error}
            </p>
          )
        )}
      </div>
    </section>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="px-4 py-2 rounded bg-black text-white text-sm font-medium disabled:opacity-50"
      disabled={pending}
    >
      {pending ? "Uploading…" : "Load raw files"}
    </button>
  );
}

