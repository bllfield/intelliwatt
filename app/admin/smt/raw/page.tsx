import AdminSmtRawClient from "./RawClient";
import ManualUploadForm from "./ManualUploadForm";

export const dynamic = "force-dynamic";

export default function AdminSmtRawPage() {
  return (
    <div className="space-y-10 pb-10">
      <ManualUploadForm />
      <AdminSmtRawClient />
    </div>
  );
}

