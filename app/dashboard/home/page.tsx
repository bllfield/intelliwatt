import { redirect } from "next/navigation";
 
export default async function HomePage() {
  // Kept for deep links/bookmarks. Home Details is now embedded in the Usage Simulator.
  redirect("/dashboard/usage/simulated#home-details");
}

 
