"use server";

import { revalidatePath } from "next/cache";
import { actionError, str, type ActionState } from "@/lib/action-state";
import { getSessionUser } from "@/server/auth/session";
import { markAllRead } from "@/server/notifications";
import { submitContact } from "@/server/support";
import { requireViewer } from "@/server/viewer";

export async function contactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await getSessionUser().catch(() => null);
    await submitContact(
      user?.id ?? null,
      { name: str(fd, "name"), email: str(fd, "email"), phone: str(fd, "phone"), topic: str(fd, "topic"), message: str(fd, "message"), website: str(fd, "website") },
      user ? "in_app" : "contact_form",
    );
    return { ok: true, message: "Thank you. Your message has been recorded and the VyaporaFlow team will reply by email." };
  } catch (err) {
    return actionError(err);
  }
}

export async function markNotificationsReadAction(): Promise<void> {
  const viewer = await requireViewer("/notifications");
  await markAllRead(viewer.userId);
  revalidatePath("/notifications");
}
