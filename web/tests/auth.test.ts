import { describe, expect, it, vi } from "vitest";

// lib/reviewer imports next/headers for getActor; these tests only use its plain helpers.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn() }));

import { checkCredentials, DEMO_PASSWORD, landingPage, listDemoAccounts } from "../lib/reviewer";
import { createSessionValue, readSessionValue } from "../lib/session";
import { db, person, url, useRolledBackDb } from "./helpers";

describe("session cookie", () => {
  const secret = "test-secret";
  const now = Date.UTC(2026, 10, 9);

  it("reads back the person it was made for", async () => {
    const { value } = await createSessionValue(7, secret, now);
    expect(await readSessionValue(value, secret, now)).toBe(7);
  });

  it("rejects an edited id, another secret, an expired cookie and junk", async () => {
    const { value, expires } = await createSessionValue(7, secret, now);
    const [, expiry, signature] = value.split(".");
    expect(await readSessionValue(`1.${expiry}.${signature}`, secret, now)).toBeNull();
    expect(await readSessionValue(value, "other-secret", now)).toBeNull();
    expect(await readSessionValue(value, secret, expires.getTime() + 1)).toBeNull();
    for (const junk of [undefined, "", "7", "7.x", "a.b.c.d"]) expect(await readSessionValue(junk, secret, now)).toBeNull();
  });
});

describe("landing page", () => {
  const manager = { id: 1, name: "M", role: "Proposal Manager", linkToken: "a".repeat(32) };
  const expert = { id: 2, name: "E", role: "Security", linkToken: "b".repeat(32) };

  it("sends the manager to the RFP list and an expert to their own items", () => {
    expect(landingPage(manager, null)).toBe("/");
    expect(landingPage(expert, null)).toBe(`/r/${"b".repeat(32)}`);
  });

  it("returns to the page asked for, but only within this site", () => {
    expect(landingPage(expert, "/rfps/171/report")).toBe("/rfps/171/report");
    for (const next of ["//evil.example", "https://evil.example", "/login"]) expect(landingPage(manager, next)).toBe("/");
  });
});

describe.skipIf(!url)("demo accounts", () => {
  useRolledBackDb();

  it("every new person gets an email made from their name", async () => {
    await person("Test Mary-Jo O'Neil", "Legal");
    const accounts = await listDemoAccounts(db);
    expect(accounts.find((a) => a.name === "Test Mary-Jo O'Neil")?.email).toBe("test.mary.jo.o.neil@tallyhouse.demo");
    expect(accounts[0].role).toBe("Proposal Manager");
  });

  it("signs in with the email in any case and the shared password, and nothing else", async () => {
    const p = await person("Test Sign In", "Security");
    expect((await checkCredentials(db, " TEST.SIGN.IN@tallyhouse.demo ", DEMO_PASSWORD)).id).toBe(p.id);
    await expect(checkCredentials(db, "test.sign.in@tallyhouse.demo", "wrong")).rejects.toThrow("don't match");
    await expect(checkCredentials(db, "nobody@tallyhouse.demo", DEMO_PASSWORD)).rejects.toThrow("don't match");
    await db.query(`update person set active = false where id = $1`, [p.id]);
    await expect(checkCredentials(db, "test.sign.in@tallyhouse.demo", DEMO_PASSWORD)).rejects.toThrow("don't match");
  });
});
