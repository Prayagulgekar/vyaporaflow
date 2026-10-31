import path from "node:path";
import { createPgliteDatabase } from "./pglite";
import { createPostgresDatabase } from "./postgres";
import type { Database } from "./types";

export type DbTarget =
  | { engine: "pglite"; dataDir: string | null }
  | { engine: "postgres"; url: string; max?: number };

export async function openDatabase(target: DbTarget): Promise<Database> {
  if (target.engine === "pglite") {
    return createPgliteDatabase(target.dataDir ? path.resolve(target.dataDir) : null);
  }
  return createPostgresDatabase(target.url, target.max);
}
