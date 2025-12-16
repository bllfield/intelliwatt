/**
 * Legacy page — EFL admin tooling is consolidated on /admin/efl/fact-cards.
 * Redirect here to keep a single-pane ops workflow.
 */

import { redirect } from "next/navigation";

export default function ManualFactCardLoaderPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const sp = props.searchParams ?? {};
  const qp = new URLSearchParams();

  const eflUrl = typeof sp.eflUrl === "string" ? sp.eflUrl : Array.isArray(sp.eflUrl) ? sp.eflUrl[0] : "";
  const offerId = typeof sp.offerId === "string" ? sp.offerId : Array.isArray(sp.offerId) ? sp.offerId[0] : "";

  if (eflUrl) qp.set("eflUrl", eflUrl);
  if (offerId) qp.set("offerId", offerId);

  const suffix = qp.toString();
  redirect(`/admin/efl/fact-cards${suffix ? `?${suffix}` : ""}`);
}


