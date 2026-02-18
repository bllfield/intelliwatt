import { redirect } from "next/navigation";
 
export default async function AppliancesPage() {
  // Kept for deep links/bookmarks. Appliances are now embedded in the Usage Simulator.
  redirect("/dashboard/usage/simulated#appliances");
}

 