import { Badge, Card, DefinitionList, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { systemHealth } from "@/server/admin";
import { requireAdmin } from "@/server/viewer";

export default async function Health() {
  await requireAdmin();
  const h = await systemHealth();
  return (
    <>
      <PageHeader title="System health" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Runtime">
          <DefinitionList
            items={[
              ["Mode", <Badge key="m" tone={h.mode === "demo" ? "warn" : "ok"}>{h.mode}</Badge>],
              ["Database engine", h.engine],
              ["Database version", h.databaseVersion.split(" on ")[0]],
              ["PostGIS", h.postgis ? "Installed (ST_DWithin search)" : "Not installed (distance formula fallback)"],
              ["Query latency", `${h.latencyMs} ms`],
              ["Node.js", h.nodeVersion],
              ["Server time", formatDateTime(h.serverTime)],
            ]}
          />
        </Card>
        <Card title={`Migrations applied (${h.migrations.length})`}>
          <ul className="font-mono text-xs">{h.migrations.map((m) => <li key={m}>{m}</li>)}</ul>
        </Card>
      </div>
    </>
  );
}
