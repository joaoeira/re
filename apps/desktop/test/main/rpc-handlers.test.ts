import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Cause, Effect, Exit } from "effect";
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

  it("returns parser tagged errors through the domain error channel", async () => {
    const invalidMarkdown = `<!--@ bad-card 0 0 9 0-->
Broken card content`;

    const exit = await Effect.runPromiseExit(
      appRpcHandlers.ParseDeckPreview({ markdown: invalidMarkdown }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected ParseDeckPreview to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag === "None") {
      throw new Error("Expected a domain failure, but received a defect or interruption.");
    }

    expect(failure.value._tag).toBe("InvalidFieldValue");
    if (failure.value._tag === "InvalidFieldValue") {
      expect(failure.value.line).toBe(1);
      expect(failure.value.field).toBe("metadata");
      expect(failure.value.value).toContain("bad-card");
    }
  });

  it("scans decks and returns full deck entries", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-scan-"));

    try {
      await fs.mkdir(path.join(rootPath, "nested"), { recursive: true });
      await fs.writeFile(path.join(rootPath, "root.md"), "# root", "utf8");
      await fs.writeFile(path.join(rootPath, "nested/child.md"), "# child", "utf8");
      await fs.writeFile(path.join(rootPath, "nested/ignore.txt"), "not a deck", "utf8");

      const result = await Effect.runPromise(appRpcHandlers.ScanDecks({ rootPath }));

      expect(result.rootPath).toBe(rootPath);
      expect(result.decks).toEqual([
        {
          absolutePath: path.join(rootPath, "nested/child.md"),
          relativePath: "nested/child.md",
          name: "child",
        },
        {
          absolutePath: path.join(rootPath, "root.md"),
          relativePath: "root.md",
          name: "root",
        },
      ]);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
