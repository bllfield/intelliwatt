"use client";

import { FormEvent, useState } from "react";

type UploadState = {
  ok: boolean | null;
  message?: string;
  error?: string;
};

export default function ManualUploadForm() {
  const [state, setState] = useState<UploadState>({ ok: null });
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file") as File | null;
    if (!file || file.size === 0) {
      setState({ ok: false, error: "Select a CSV file to upload." });
      return;
    }

    setPending(true);
    setState({ ok: null });
    try {
      const response = await fetch("/api/admin/smt/manual-upload", {
        method: "POST",
        body: formData,
      });
      const json = await response.json().catch(() => ({}));
      if (response.ok && json?.ok) {
        setState({
          ok: true,
          message:
            json?.message ||
            `Uploaded ${file.name} (${file.size.toLocaleString()} bytes) successfully.`,
        });
        form.reset();
      } else {
        setState({
          ok: false,
          error:
            json?.error ||
            `Upload failed (HTTP ${response.status}). Check the raw response for details.`,
        });
      }
    } catch (err: any) {
      setState({
        ok: false,
        error: err?.message || "Unexpected error while uploading.",
      });
    } finally {
      setPending(false);
    }
  }

  const alertClasses =
    state.ok === null
      ? "hidden"
      : state.ok
      ? "rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
      : "rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700";

  return (
    <section className="max-w-6xl mx-auto p-6 space-y-4 border border-gray-200 rounded-lg bg-white shadow-sm">
      <header>
        <h1 className="text-2xl font-semibold">Manual SMT CSV Upload</h1>
        <p className="text-sm text-gray-600 mt-1">
          Upload an SMT-style CSV to persist it as a RawSmtFile and immediately normalize it into{" "}
          <code>SmtInterval</code>. Files are posted inline via <code>/api/admin/smt/pull</code> and then normalized.
        </p>
      </header>

      <form onSubmit={handleSubmit} encType="multipart/form-data" className="space-y-4">
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
            This form streams uploads through the manual-upload proxy so large files (tens of MB) are supported.
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
          <button
            type="submit"
            className="px-4 py-2 rounded bg-black text-white text-sm font-medium disabled:opacity-50"
            disabled={pending}
          >
            {pending ? "Uploading…" : "Load raw files"}
          </button>
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

