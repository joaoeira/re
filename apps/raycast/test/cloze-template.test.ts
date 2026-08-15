import { describe, expect, it } from "vitest";

import { appendNextClozeTemplate } from "../src/cloze-template";

describe("appendNextClozeTemplate", () => {
  it("appends a template using the next cloze index", () => {
    expect(appendNextClozeTemplate("{{c1::Paris}} is in France. ")).toBe(
      "{{c1::Paris}} is in France. {{c2::}}",
    );
  });
});
