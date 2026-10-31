/**
 * Starts the app for Playwright end-to-end tests against a throwaway demo
 * database (.data/e2e), never your normal demo data or any production
 * database. Builds the app first if no production build exists.
 *
 *   npm run test:e2e        (Playwright starts this script itself)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const port = process.env.E2E_PORT ?? "3100";
const env: NodeJS.ProcessEnv = {
  ...process.env,
  APP_MODE: "demo",
  DEMO_DB_PATH: ".data/e2e/pglite",
  DEMO_UPLOAD_DIR: ".data/e2e/uploads",
  DEMO_DATABASE_URL: "",
  NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
  NODE_ENV: "production",
};

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

rmSync(path.resolve(".data/e2e"), { recursive: true, force: true });
run("npx", ["tsx", "scripts/db.ts", "setup"]);
if (!existsSync(".next/BUILD_ID") || process.env.E2E_BUILD === "1") run("npx", ["next", "build"]);

const server = spawn("npx", ["next", "start", "-p", port], { stdio: "inherit", env, shell: process.platform === "win32" });
const stop = () => server.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
