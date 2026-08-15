import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { rewriteMathForRaycast } from "../src/raycast-markdown";

describe("Raycast Markdown compatibility", () => {
  it.effect("rewrites re inline math using Raycast's supported delimiters", () =>
    Effect.gen(function* () {
      const markdown = yield* rewriteMathForRaycast("$n$ bits");

      expect(markdown).toBe("\\(n\\) bits");
    }),
  );

  it.effect("rewrites multiple inline expressions without reformatting surrounding Markdown", () =>
    Effect.gen(function* () {
      const markdown = yield* rewriteMathForRaycast("**From $x$ to $y$**");

      expect(markdown).toBe("**From \\(x\\) to \\(y\\)**");
    }),
  );

  it.effect("preserves display math", () =>
    Effect.gen(function* () {
      const inlineDisplay = yield* rewriteMathForRaycast("Value: $$2^n$$ bytes");
      const blockDisplay = yield* rewriteMathForRaycast("Before\n\n$$\nx^2\n$$\n\nAfter");

      expect(inlineDisplay).toBe("Value: $$2^n$$ bytes");
      expect(blockDisplay).toBe("Before\n\n$$\nx^2\n$$\n\nAfter");
    }),
  );

  it.effect("preserves code, escaped dollars, and unmatched currency", () =>
    Effect.gen(function* () {
      const input = "`$inline$` and \\$escaped and costs $5\n\n```txt\n$code$\n```";
      const markdown = yield* rewriteMathForRaycast(input);

      expect(markdown).toBe(input);
    }),
  );

  it.effect("preserves existing Raycast inline math", () =>
    Effect.gen(function* () {
      const markdown = yield* rewriteMathForRaycast("Already \\(n\\) bits");

      expect(markdown).toBe("Already \\(n\\) bits");
    }),
  );
});
