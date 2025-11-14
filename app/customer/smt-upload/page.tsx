import type { Metadata } from "next";
import SmtUploadForm from "@/components/customer/SmtUploadForm";

export const metadata: Metadata = {
  title: "Upload SMT Interval Data",
};

export default function CustomerSmtUploadPage() {
  const uploadUrl = process.env.NEXT_PUBLIC_SMT_UPLOAD_URL;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Upload Your Smart Meter Texas CSV</h1>
        <p className="text-sm text-gray-700">
          Provide a full 12-month interval CSV exported from Smart Meter Texas. We will process the file and
          add the readings to your IntelliWatt account. Large files are supported through our secure droplet
          pipeline and typically ingest within a few minutes.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Upload requirements</h2>
        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
          <li>Include your IntelliWatt Home ID or account reference so we can route the data correctly.</li>
          <li>Upload the complete CSV downloaded from Smart Meter Texas (no edits or truncation needed).</li>
          <li>You can upload up to 5 files per month. If you hit the limit, contact support for assistance.</li>
        </ul>
      </section>

      <SmtUploadForm uploadUrl={uploadUrl} />

      <section className="text-xs text-gray-500 space-y-1">
        <p>
          Need help exporting the CSV? Visit <a className="text-blue-600 underline" href="https://smartmetertexas.com/">
            Smart Meter Texas
          </a> and download the 15-minute interval usage for the last 12 months, then upload it here.
        </p>
        <p>
          Once uploaded, IntelliWatt will normalize the data automatically. Check back later to view your updated
          energy analysis.
        </p>
      </section>
    </div>
  );
}
