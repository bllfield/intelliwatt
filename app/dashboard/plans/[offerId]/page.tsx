import PlanDetailsClient from "./PlanDetailsClient";

export default async function PlanDetailsPage(props: { params: Promise<{ offerId: string }> }) {
  const params = await props.params;
  const offerId = params?.offerId ?? "";
  return <PlanDetailsClient offerId={offerId} />;
}


