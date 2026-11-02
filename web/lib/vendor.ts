import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

import type { Vendor } from "./scoring";

// config/vendor.yaml is shared with the Python side; everything vendor-specific lives there.
const VENDOR_FILE = path.resolve(process.cwd(), "..", "config", "vendor.yaml");

let cached: { mtimeMs: number; vendor: Vendor } | null = null;

/** Read again whenever the file changes, so an edited rule never meets a running server's old copy. */
export function loadVendor(): Vendor {
  const { mtimeMs } = statSync(VENDOR_FILE);
  if (cached?.mtimeMs !== mtimeMs) cached = { mtimeMs, vendor: parse(readFileSync(VENDOR_FILE, "utf8")) as Vendor };
  return cached.vendor;
}
