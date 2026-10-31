import "server-only";
import { userTx } from "@/server/rpc";

export async function listNotifications(userId: string, limit = 20) {
  return userTx(userId, (q) =>
    q.query<{ id: string; kind: string; title: string; body: string | null; link: string | null; read_at: Date | null; created_at: Date }>(
      "select id, kind, title, body, link, read_at, created_at from public.notifications where user_id = auth.uid() order by created_at desc limit $1",
      [limit],
    ),
  );
}

export async function unreadCount(userId: string) {
  const rows = await userTx(userId, (q) =>
    q.query<{ n: number }>("select count(*)::int as n from public.notifications where user_id = auth.uid() and read_at is null"),
  );
  return rows[0]?.n ?? 0;
}

export async function markAllRead(userId: string) {
  await userTx(userId, (q) => q.query("update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null"));
}
