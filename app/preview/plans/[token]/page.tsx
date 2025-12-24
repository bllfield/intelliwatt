import { notFound } from "next/navigation";
import PreviewPlansClient from "./PreviewPlansClient";
import snapshot from "@/data/preview/wattbuy-plan-cards-snapshot.json";

export const dynamic = "force-static";

export default function PreviewPlansPage({ params }: { params: { token: string } }) {
  const expected = process.env.PREVIEW_PLANS_TOKEN ?? "";
  const provided = String(params?.token ?? "");
  if (!expected || provided !== expected) return notFound();

  const plans = Array.isArray((snapshot as any)?.plans) ? ((snapshot as any).plans as any[]) : [];
  return (
    <div className="min-h-screen bg-brand-white">
      <PreviewPlansClient plans={plans as any} />
    </div>
  );
}


