import { redirect } from "next/navigation";

/** The studio opens on Enhance (product-spec §2.1 — 3-tab bottom nav). */
export default function Home() {
  redirect("/enhance");
}
