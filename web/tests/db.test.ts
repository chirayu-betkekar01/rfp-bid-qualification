import { describe, expect, it } from "vitest";

import { caFrom } from "../lib/db";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIDxDCC\nAqygAwIB\n-----END CERTIFICATE-----";

describe("caFrom", () => {
  it("keeps a PEM with real line breaks", () => {
    expect(caFrom(PEM)).toBe(PEM);
  });

  it("turns \\n escapes into line breaks", () => {
    expect(caFrom(PEM.replace(/\n/g, "\\n"))).toBe(PEM);
  });

  it("drops the quotes a pasted .env line leaves behind", () => {
    expect(caFrom(`"${PEM.replace(/\n/g, "\\n")}"`)).toBe(PEM);
    expect(caFrom(`'${PEM}'`)).toBe(PEM);
    expect(caFrom(`  "${PEM}"\n`)).toBe(PEM);
  });

  it("treats a missing or blank value as no CA", () => {
    expect(caFrom(undefined)).toBeUndefined();
    expect(caFrom("  ")).toBeUndefined();
    expect(caFrom('""')).toBeUndefined();
  });
});
