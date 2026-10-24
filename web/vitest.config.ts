import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "vitest/config";

// Secrets live in the repo-root .env, shared with the Python side (rule 9).
loadEnvConfig(path.resolve(process.cwd(), ".."));

export default defineConfig({
  // The tests share one database and insert the same test people, so files run one at a time.
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false },
});
