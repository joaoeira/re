import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { appRpcHandlers } from "@shared/rpc/handlers";

describe("main rpc handlers", () => {
  it("returns bootstrap payload", async () => {
    const result = await Effect.runPromise(appRpcHandlers.GetBootstrapData());

    expect(result.appName).toBe("re Desktop");
    expect(result.message).toContain("typed Effect RPC");
  });

  it("parses markdown and returns item/card counts", async () => {
    const markdown = `---
title: Sample
---

<!--@ card-a 0 0 0 0-->
Question one
---
Answer one

<!--@ card-b 0 0 0 0-->
Question two
---
Answer two
`;

    const result = await Effect.runPromise(appRpcHandlers.ParseDeckPreview({ markdown }));

    expect(result).toEqual({
      items: 2,
      cards: 2,
    });
  });

  it("maps parse failures to typed rpc errors", async () => {
    const invalidMarkdown = `<!--@ bad-card 0 0 9 0-->
Broken card content`;

    await expect(
      Effect.runPromise(appRpcHandlers.ParseDeckPreview({ markdown: invalidMarkdown })),
    ).rejects.toThrow(/PARSE_ERROR/);
  });
});
