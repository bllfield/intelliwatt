import { redirect } from "next/navigation";

export default function ManualEntryPage() {
  // Manual entry is simulator-only now.
  redirect("/dashboard/usage/simulated#start-here");
}