import PlanDetailsClient from "./PlanDetailsClient";

export const dynamic = "force-dynamic";

export default async function PlanDetailsPage(props: { params: Promise<{ offerId: string }> }) {
  const params = await props.params;
  const offerId = params?.offerId ?? "";
  return <PlanDetailsClient offerId={offerId} />;
}


