import { describe, expect, it } from "vitest";
import { DICT } from "./i18n";

describe("i18n", () => {
  it("ar, en and de have exactly the same keys, none empty", () => {
    const keys = Object.keys(DICT.en).sort();
    for (const l of ["ar", "de"] as const) expect(Object.keys(DICT[l]).sort()).toEqual(keys);
    for (const d of Object.values(DICT))
      for (const v of Object.values(d)) expect(v.trim()).not.toBe("");
  });
});
