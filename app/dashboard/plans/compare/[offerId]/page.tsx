import PlanCompareClient from "@/components/dashboard/plans/PlanCompareClient";

export const dynamic = "force-dynamic";

export default function ComparePage(props: { params: { offerId: string } }) {
  const offerId = props?.params?.offerId ?? "";
  return <PlanCompareClient offerId={offerId} />;
}


