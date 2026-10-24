import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "vitest/config";

// Secrets live in the repo-root .env, shared with the Python side (rule 9).
loadEnvConfig(path.resolve(process.cwd(), ".."));

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
