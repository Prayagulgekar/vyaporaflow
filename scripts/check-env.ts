/**
 * Runs before `npm start`. Fails with a clear message when the configuration
 * for the selected APP_MODE is incomplete, instead of starting a server that
 * cannot work. Never prints secret values.
 */
import { loadEnvFiles } from "./load-env";
import { parseEnv } from "../src/lib/env";

loadEnvFiles([".env.production.local", ".env.local", ".env.production", ".env"]);

try {
  const env = parseEnv(process.env);
  if (env.APP_MODE === "production") {
    const leaked = Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_") && /SERVICE|SECRET|PASSWORD|DATABASE/i.test(k));
    if (leaked.length) {
      console.error(`Refusing to start: ${leaked.join(", ")} looks like a secret exposed to the browser (NEXT_PUBLIC_ prefix).`);
      process.exit(1);
    }
  }
  console.log(`Configuration OK (APP_MODE=${env.APP_MODE})`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
