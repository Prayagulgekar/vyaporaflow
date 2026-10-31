import { z } from "zod";

/**
 * Runtime configuration. Two explicitly separated modes:
 *
 *  - demo:       local demonstration. Data persists in an embedded PostgreSQL
 *                (PGlite) under DEMO_DB_PATH, or in a local PostgreSQL server
 *                when DEMO_DATABASE_URL is set. Local email/password auth.
 *  - production: Supabase Auth + Supabase PostgreSQL (DATABASE_URL). Missing
 *                configuration is a hard error; there is no fallback to demo data.
 */
const modeSchema = z.enum(["demo", "production"]);

const demoSchema = z.object({
  APP_MODE: z.literal("demo"),
  NEXT_PUBLIC_APP_NAME: z.string().default("VyaporaFlow"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  DEMO_DB_PATH: z.string().min(1).default(".data/pglite"),
  DEMO_DATABASE_URL: z.string().url().optional(),
  DEMO_UPLOAD_DIR: z.string().min(1).default(".data/uploads"),
});

const productionSchema = z.object({
  APP_MODE: z.literal("production"),
  NEXT_PUBLIC_APP_NAME: z.string().default("VyaporaFlow"),
  NEXT_PUBLIC_APP_URL: z.string().url({ message: "NEXT_PUBLIC_APP_URL must be the public https URL of the app" }),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url({ message: "NEXT_PUBLIC_SUPABASE_URL is required in production mode" }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required in production mode"),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a postgres:// connection string (Supabase pooler)"),
  SUPABASE_STORAGE_BUCKET: z.string().default("company-assets"),
});

export type DemoEnv = z.infer<typeof demoSchema>;
export type ProductionEnv = z.infer<typeof productionSchema>;
export type AppEnv = DemoEnv | ProductionEnv;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): AppEnv {
  const mode = modeSchema.safeParse(source.APP_MODE ?? "demo");
  if (!mode.success) {
    throw new ConfigError(`APP_MODE must be "demo" or "production" (got "${source.APP_MODE}")`);
  }
  const clean = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  const schema = mode.data === "demo" ? demoSchema : productionSchema;
  const parsed = schema.safeParse({ ...clean, APP_MODE: mode.data });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new ConfigError(`Invalid ${mode.data} configuration:\n${issues}\nSee .env.example and docs/configuration.md.`);
  }
  return parsed.data;
}

let cached: AppEnv | undefined;

export function getEnv(): AppEnv {
  cached ??= parseEnv(process.env);
  return cached;
}

export function isDemoMode(): boolean {
  return getEnv().APP_MODE === "demo";
}
