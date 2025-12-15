export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import React from "react";

export default async function EflManualReviewPage() {
  // Backwards-compat route: the DB-backed EFL quarantine UI lives at /admin/efl-review.
  redirect("/admin/efl-review");
}


