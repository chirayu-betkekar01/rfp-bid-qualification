import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

import type { Vendor } from "./scoring";

// config/vendor.yaml is shared with the Python side; everything vendor-specific lives there.
const VENDOR_FILE = path.resolve(process.cwd(), "..", "config", "vendor.yaml");

let cached: Vendor | null = null;

export function loadVendor(): Vendor {
  cached ??= parse(readFileSync(VENDOR_FILE, "utf8")) as Vendor;
  return cached;
}
