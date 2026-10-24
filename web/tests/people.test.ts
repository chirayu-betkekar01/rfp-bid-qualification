import { describe, expect, it } from "vitest";

import { assignItem } from "../lib/assignments";
import {
  addContributor, listContributors, listPeople, setContributorActive, updateContributor,
} from "../lib/people";
import { db, item, person, rfp, section, url, useRolledBackDb } from "./helpers";

describe.skipIf(!url)("contributors", () => {
  useRolledBackDb();

  it("an added contributor shows up in the owner dropdowns", async () => {
    const added = await addContributor(db, { name: "  Test   Alex ", role: "Security" });
    expect(added).toMatchObject({ name: "Test Alex", role: "Security" });
    expect((await listPeople(db)).map((p) => p.name)).toContain("Test Alex");
  });

  it("names must be people and unique, ignoring case", async () => {
    await addContributor(db, { name: "Test Alex", role: "Security" });
    await expect(addContributor(db, { name: "test alex", role: "Legal" })).rejects.toThrow("already on the team");
    await expect(addContributor(db, { name: "AI", role: "Legal" })).rejects.toThrow("must be people");
    await expect(addContributor(db, { name: "Test Blake", role: " " })).rejects.toThrow("role");
  });

  it("renames and changes role", async () => {
    const alex = await addContributor(db, { name: "Test Alex", role: "Security" });
    await updateContributor(db, alex.id, { name: "Test Alexis", role: "Legal" });
    expect((await listPeople(db)).find((p) => p.id === alex.id)).toMatchObject({ name: "Test Alexis", role: "Legal" });
  });

  it("removing hides someone from the dropdowns, and only once they hold nothing unanswered", async () => {
    const id = await rfp();
    const row = await item(id, await section(id, "IV"), "R-001", 1, "Encrypt data");
    const sam = await person("Test Sam", "Security");
    await assignItem(db, row, sam.id, "Morgan");
    await expect(setContributorActive(db, sam.id, false)).rejects.toThrow("1 unanswered line item");

    await assignItem(db, row, null, "Morgan");
    await setContributorActive(db, sam.id, false);
    expect((await listPeople(db)).map((p) => p.id)).not.toContain(sam.id);
    const listed = (await listContributors(db, id)).find((c) => c.id === sam.id);
    expect(listed).toMatchObject({ active: false });

    await setContributorActive(db, sam.id, true);
    expect((await listPeople(db)).map((p) => p.id)).toContain(sam.id);
  });

  it("counts what each contributor holds on this RFP", async () => {
    const id = await rfp();
    const s = await section(id, "IV");
    const sam = await person("Test Sam", "Security");
    for (const ref of ["R-001", "R-002"]) await assignItem(db, await item(id, s, ref, 1, ref), sam.id, "Morgan");
    expect((await listContributors(db, id)).find((c) => c.id === sam.id)).toMatchObject({ heldHere: 2, answeredHere: 0 });
  });
});
