import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Secrets live in the repo-root .env, shared with the Python side (rule 9).
const repoRoot = path.resolve(process.cwd(), "..");
loadEnvConfig(repoRoot);

const nextConfig: NextConfig = {
  // The app reads two things from outside web/: the scoring rules shared with Python, and the
  // fictional demo RFP PDFs. Trace from the repo root so a deployment (Vercel) includes them.
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    "/**": ["../config/vendor.yaml", "../data/mock_rfps/*.pdf"],
  },
  // Never ship the real test RFPs (buyer contact details, rule 8) or secrets.
  outputFileTracingExcludes: {
    "/**": ["../data/test_rfps/**", "../.env*", "../logs/**", "../data/mock_rfps/*.txt"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
