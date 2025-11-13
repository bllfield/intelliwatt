import AdminSmtRawClient from "./RawClient";
import ManualUploadForm, { UploadFormState } from "./ManualUploadForm";
import { uploadSmtManualCsv } from "@/lib/admin/smtManualUpload";

export const dynamic = "force-dynamic";

async function uploadRawFilesAction(
  _prevState: UploadFormState,
  formData: FormData,
): Promise<UploadFormState> {
  "use server";

  const file = formData.get("file");
  const esiid = (formData.get("esiid") as string | null)?.trim() || undefined;
  const meter = (formData.get("meter") as string | null)?.trim() || undefined;

  if (!file || !(file instanceof File)) {
    return { ok: false, error: "No file uploaded." };
  }

  try {
    const result = await uploadSmtManualCsv({ file, esiid, meter });
    if (result.ok) {
      return {
        ok: true,
        message: result.message ?? "Upload succeeded.",
      };
    }
    return {
      ok: false,
      error: result.error ?? "Upload failed.",
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Unexpected error during upload.",
    };
  }
}

export default function AdminSmtRawPage() {
  return (
    <div className="space-y-10 pb-10">
      <ManualUploadForm action={uploadRawFilesAction} />
      <AdminSmtRawClient />
    </div>
  );
}

