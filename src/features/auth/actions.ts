"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actionError, str, type ActionState } from "@/lib/action-state";
import { login, logout, register, requestPasswordReset, resetPassword } from "@/server/auth/service";
import { acceptInvitation, completeOnboarding, updateMyProfile } from "@/server/companies";
import { ACTIVE_COMPANY_COOKIE, getViewer, homePathFor, isPlatformAdmin, requireViewer } from "@/server/viewer";

/** Only same-site relative paths are allowed as post-login destinations. */
function safeNext(raw: string): string | null {
  return raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : null;
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await login({ email: str(fd, "email"), password: String(fd.get("password") ?? "") });
  } catch (err) {
    return actionError(err);
  }
  const viewer = await getViewer();
  redirect(safeNext(str(fd, "next")) ?? (viewer ? homePathFor(viewer) : "/"));
}

/**
 * Sign-in for platform administrators. Anyone else is signed straight back
 * out. Admin access itself is only ever granted with `npm run admin:grant`.
 */
export async function adminLoginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { userId } = await login({ email: str(fd, "email"), password: String(fd.get("password") ?? "") });
    if (!(await isPlatformAdmin(userId))) {
      await logout();
      return { ok: false, message: "This account is not a platform administrator. Business accounts sign in on the normal sign-in page." };
    }
  } catch (err) {
    return actionError(err);
  }
  const next = safeNext(str(fd, "next"));
  redirect(next && (next === "/admin" || next.startsWith("/admin/")) ? next : "/admin");
}

export async function registerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let status: "signed_in" | "confirm_email";
  try {
    ({ status } = await register({
      full_name: str(fd, "full_name"),
      email: str(fd, "email"),
      password: String(fd.get("password") ?? ""),
      account_type: str(fd, "account_type"),
    }));
  } catch (err) {
    return actionError(err);
  }
  if (status === "confirm_email") {
    return { ok: true, message: "Check your inbox. We sent a link to confirm your email address before you continue." };
  }
  const invite = str(fd, "invite");
  redirect(/^[a-f0-9]{64}$/.test(invite) ? `/invite/${invite}` : str(fd, "account_type") === "delivery_worker" ? "/d" : "/onboarding");
}

export async function logoutAction(): Promise<void> {
  await logout();
  (await cookies()).delete(ACTIVE_COMPANY_COOKIE);
  redirect("/");
}

export async function switchCompanyAction(fd: FormData): Promise<void> {
  const viewer = await requireViewer();
  const id = str(fd, "company_id");
  const m = viewer.memberships.find((x) => x.companyId === id);
  if (m) {
    (await cookies()).set(ACTIVE_COMPANY_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/" });
    redirect(m.role === "delivery_worker" ? "/d" : m.companyKind === "wholesaler" ? "/w" : "/r");
  }
  redirect(homePathFor(viewer));
}

export async function forgotPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const { simulatedLink } = await requestPasswordReset(str(fd, "email"));
    return {
      ok: true,
      message: "If an account exists for this email, a reset link has been sent.",
      data: simulatedLink ? { simulatedLink } : undefined,
    };
  } catch (err) {
    return actionError(err);
  }
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const pw = String(fd.get("password") ?? "");
  if (pw !== String(fd.get("confirm") ?? "")) return { ok: false, message: "The passwords do not match", fieldErrors: { confirm: ["Passwords do not match"] } };
  try {
    await resetPassword(str(fd, "token") || null, pw);
  } catch (err) {
    return actionError(err);
  }
  redirect("/login?reset=1");
}

export async function onboardingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const viewer = await requireViewer("/onboarding");
  const kind = str(fd, "kind");
  try {
    const companyId = await completeOnboarding(viewer.userId, {
      kind: kind as "wholesaler" | "retailer",
      name: str(fd, "name"),
      contact_name: str(fd, "contact_name"),
      phone: str(fd, "phone"),
      email: str(fd, "email"),
      gstin: str(fd, "gstin"),
      business_category: str(fd, "business_category"),
      shop_type: str(fd, "shop_type"),
      preferred_language: (str(fd, "preferred_language") || "en") as "en",
      address: {
        line1: str(fd, "address.line1"),
        line2: str(fd, "address.line2"),
        city: str(fd, "address.city"),
        state_code: str(fd, "address.state_code"),
        pincode: str(fd, "address.pincode"),
        latitude: str(fd, "address.latitude"),
        longitude: str(fd, "address.longitude"),
      },
    });
    (await cookies()).set(ACTIVE_COMPANY_COOKIE, companyId, { httpOnly: true, sameSite: "lax", path: "/" });
  } catch (err) {
    return actionError(err);
  }
  redirect(kind === "wholesaler" ? "/w?welcome=1" : "/r?welcome=1");
}

export async function acceptInviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const token = str(fd, "token");
  const viewer = await requireViewer(`/invite/${token}`);
  let companyId: string;
  try {
    companyId = await acceptInvitation(viewer.userId, token);
  } catch (err) {
    return actionError(err);
  }
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, companyId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/app");
}

export async function updateProfileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const viewer = await requireViewer("/account");
  try {
    await updateMyProfile(viewer.userId, { full_name: str(fd, "full_name"), phone: str(fd, "phone"), preferred_language: str(fd, "preferred_language") || "en" });
    return { ok: true, message: "Profile saved" };
  } catch (err) {
    return actionError(err);
  }
}
