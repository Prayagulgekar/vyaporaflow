"use server";

import { revalidatePath } from "next/cache";
import { actionError, str, type ActionState } from "@/lib/action-state";
import { setCompanyStatus, setSetting, setVerification, updateSupport } from "@/server/admin";
import { requireAdmin } from "@/server/viewer";

async function guard<T>(fn: (userId: string) => Promise<T>, message: string, path: string): Promise<ActionState> {
  const viewer = await requireAdmin();
  try {
    await fn(viewer.userId);
  } catch (err) {
    return actionError(err);
  }
  revalidatePath(path);
  return { ok: true, message };
}

export async function companyStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const status = str(fd, "status");
  return guard((u) => setCompanyStatus(u, str(fd, "company_id"), status, str(fd, "reason") || null), status === "suspended" ? "Business suspended" : "Business reactivated", "/admin/companies");
}

export async function verificationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard((u) => setVerification(u, str(fd, "company_id"), str(fd, "status"), str(fd, "note") || null), "Verification updated", "/admin/companies");
}

export async function supportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard((u) => updateSupport(u, str(fd, "id"), str(fd, "status"), str(fd, "note") || null), "Support request updated", "/admin/support");
}

export async function settingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard((u) => setSetting(u, str(fd, "key"), String(fd.get("value") ?? "")), "Setting saved", "/admin/settings");
}
