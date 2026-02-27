import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { runIpcEffect } from "@/lib/ipc-query";

class RecoverableError extends Error {
  override readonly name = "RecoverableError";
}

describe("runIpcEffect", () => {
  it("preserves typed Effect failures", async () => {
    const recoverable = new RecoverableError("recoverable");

    await expect(runIpcEffect(Effect.fail(recoverable))).rejects.toBe(recoverable);
  });

  it("converts defects to Error instances", async () => {
    await expect(runIpcEffect(Effect.die("defect"))).rejects.toMatchObject({
      name: "Error",
      message: "defect",
    });
  });
});
