import { redirect } from "next/navigation";
import { homePathFor, requireViewer } from "@/server/viewer";

/** Sends a signed-in user to the right workspace. */
export default async function AppHome() {
  const viewer = await requireViewer("/app");
  redirect(homePathFor(viewer));
}
