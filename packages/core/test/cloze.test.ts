import { Effect } from "effect";
import { describe, it, assert } from "vitest";
import {
  ClozeSyntaxError,
  hasClozeDeletion,
  nextClozeDeletionIndex,
  parseClozeDeletions,
  parseClozeDeletionsStrict,
  replaceClozeDeletions,
  replaceClozeDeletionsWithContext,
} from "../src/cloze.ts";

const runStrict = (content: string) => Effect.runSync(parseClozeDeletionsStrict(content));

const runStrictError = (content: string) =>
  Effect.runSync(parseClozeDeletionsStrict(content).pipe(Effect.flip));

describe("cloze helpers", () => {
  it("detects cloze syntax", () => {
    assert.strictEqual(hasClozeDeletion("plain text"), false);
    assert.strictEqual(hasClozeDeletion("{{c1::answer}}"), true);
    assert.strictEqual(hasClozeDeletion("{{c::invalid}}"), false);
  });

  it("parses cloze syntax with optional hint", () => {
    const parsed = parseClozeDeletions("The {{c2::Paris::capital city}} is {{c3::France}}.");

    assert.strictEqual(parsed.length, 2);

    assert.strictEqual(parsed[0]!.index, 2);
    assert.strictEqual(parsed[0]!.hidden, "Paris");
    assert.strictEqual(parsed[0]!.hint, "capital city");
    assert.strictEqual(parsed[0]!.start, 4);
    assert.strictEqual(parsed[0]!.end, 31);

    assert.strictEqual(parsed[1]!.index, 3);
    assert.strictEqual(parsed[1]!.hidden, "France");
    assert.strictEqual(parsed[1]!.hint, null);
  });

  it("keeps only the first hint segment when multiple separators are present", () => {
    const parsed = parseClozeDeletions("{{c1::answer::hint-a::hint-b}}");

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0]!.hidden, "answer");
    assert.strictEqual(parsed[0]!.hint, "hint-a");
  });

  it("treats empty hint as absent", () => {
    const parsed = parseClozeDeletions("{{c1::Paris::}}");
    assert.strictEqual(parsed[0]!.hidden, "Paris");
    assert.strictEqual(parsed[0]!.hint, null);
  });

  it("ignores incomplete cloze syntax while parsing", () => {
    const parsed = parseClozeDeletions("start {{c3::unfinished");
    assert.strictEqual(parsed.length, 0);
  });

  it("does not parse clozes containing a closing brace inside hidden content", () => {
    const parsed = parseClozeDeletions("{{c1::a}b}}");
    assert.strictEqual(parsed.length, 0);
  });

  it("computes the next cloze index", () => {
    assert.strictEqual(nextClozeDeletionIndex("{{c3::a}} {{c1::b}}"), 4);
    assert.strictEqual(nextClozeDeletionIndex("plain text"), 1);
    assert.strictEqual(nextClozeDeletionIndex("{{c3::unfinished"), 4);
    assert.strictEqual(nextClozeDeletionIndex("{{c3::unfinished {{c7::"), 8);
  });

  it("replaces cloze blocks while preserving surrounding text", () => {
    const output = replaceClozeDeletions("A {{c1::x}} and {{c2::y::hint}}", (deletion) =>
      deletion.hint ? `[${deletion.hint}]` : `[${deletion.hidden}]`,
    );

    assert.strictEqual(output, "A [x] and [hint]");
  });

  it("returns input unchanged when no cloze syntax is parsed", () => {
    const input = "plain text {{c1::unfinished";
    const output = replaceClozeDeletions(input, () => "[x]");

    assert.strictEqual(output, input);
  });
});

describe("brace-balanced cloze parsing", () => {
  it("parses cloze containing LaTeX with single braces", () => {
    const parsed = parseClozeDeletions("{{c1::x^{2}}}");

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0]!.hidden, "x^{2}");
    assert.strictEqual(parsed[0]!.raw, "{{c1::x^{2}}}");
  });

  it("parses cloze containing LaTeX fraction", () => {
    const parsed = parseClozeDeletions("{{c1::\\frac{a}{b}}}");

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0]!.hidden, "\\frac{a}{b}");
  });

  it("parses cloze containing nested LaTeX braces", () => {
    const parsed = parseClozeDeletions("{{c1::\\frac{x^{2}}{y^{3}}}}");

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0]!.hidden, "\\frac{x^{2}}{y^{3}}");
  });

  it("parses cloze with braces and hint", () => {
    const parsed = parseClozeDeletions("{{c1::x^{2}::exponent}}");

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0]!.hidden, "x^{2}");
    assert.strictEqual(parsed[0]!.hint, "exponent");
  });

  it("parses multiple clozes with braces", () => {
    const parsed = parseClozeDeletions("${{c1::x^{2}}} + {{c2::y^{3}}}$");

    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0]!.hidden, "x^{2}");
    assert.strictEqual(parsed[1]!.hidden, "y^{3}");
  });

  it("tracks correct positions for braced content", () => {
    const input = "E = {{c1::mc^{2}}}";
    const parsed = parseClozeDeletions(input);

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0]!.start, 4);
    assert.strictEqual(parsed[0]!.end, 18);
    assert.strictEqual(input.slice(parsed[0]!.start, parsed[0]!.end), "{{c1::mc^{2}}}");
  });

  it("skips cloze with unbalanced braces", () => {
    const parsed = parseClozeDeletions("{{c1::x^{2}}");

    assert.strictEqual(parsed.length, 0);
  });

  it("still parses simple cloze without braces", () => {
    const parsed = parseClozeDeletions("{{c1::mc^2}}");

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0]!.hidden, "mc^2");
  });

  it("replaces braced cloze content correctly", () => {
    const output = replaceClozeDeletions("$E = {{c1::mc^{2}}}$", (d) => `[${d.hidden}]`);

    assert.strictEqual(output, "$E = [mc^{2}]$");
  });

  it("parses cloze with \\sqrt{}", () => {
    const parsed = parseClozeDeletions("{{c1::\\sqrt{n+1}}}");

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0]!.hidden, "\\sqrt{n+1}");
  });

  it("parses cloze with \\text{} inside LaTeX", () => {
    const parsed = parseClozeDeletions("{{c1::x \\text{where } x > 0}}");

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0]!.hidden, "x \\text{where } x > 0");
  });

  it("handles escaped braces in cloze content", () => {
    const parsed = parseClozeDeletions("{{c1::\\{a\\}}}");

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0]!.hidden, "\\{a\\}");
  });

  it("handles :: inside braces for hint separator", () => {
    const parsed = parseClozeDeletions("{{c1::\\text{a::b}}}");

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0]!.hidden, "\\text{a::b}");
    assert.strictEqual(parsed[0]!.hint, null);
  });
});

describe("strict cloze parsing", () => {
  it("preserves valid syntax including hints, nested braces, escapes, and math", () => {
    const parsed = runStrict(
      "The {{c1::Paris::capital}} of ${{c2::\\frac{x^{2}}{y}}}$ is {{c3::\\{ok\\}}}.",
    );

    assert.strictEqual(parsed.length, 3);
    assert.strictEqual(parsed[0]!.hidden, "Paris");
    assert.strictEqual(parsed[0]!.hint, "capital");
    assert.strictEqual(parsed[1]!.hidden, "\\frac{x^{2}}{y}");
    assert.strictEqual(parsed[2]!.hidden, "\\{ok\\}");
  });

  it("allows index zero and empty hidden text", () => {
    const parsed = runStrict("{{c0::}} and {{c1::}}");

    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0]!.index, 0);
    assert.strictEqual(parsed[0]!.hidden, "");
    assert.strictEqual(parsed[1]!.hidden, "");
  });

  it("does not treat arbitrary double-brace text as a cloze error", () => {
    const parsed = runStrict("See {{capital}} and {{cx}} and {{not a cloze}}.");
    assert.strictEqual(parsed.length, 0);
  });

  it("reports an unclosed cloze with start, end, and fragment", () => {
    const content = "start {{c3::unfinished";
    const error = runStrictError(content);

    assert.ok(error instanceof ClozeSyntaxError);
    assert.strictEqual(error.issues.length, 1);
    assert.strictEqual(error.issues[0]!.reason, "unclosed");
    assert.strictEqual(error.issues[0]!.start, content.indexOf("{{c3::"));
    assert.strictEqual(error.issues[0]!.end, content.length);
    assert.strictEqual(error.issues[0]!.fragment, "{{c3::unfinished");
  });

  it("reports incomplete closers after nested braces as unclosed", () => {
    const content = "{{c1::x^{2}}";
    const error = runStrictError(content);

    assert.strictEqual(error.issues[0]!.reason, "unclosed");
    assert.strictEqual(error.issues[0]!.start, 0);
    assert.strictEqual(error.issues[0]!.end, content.length);
  });

  it("reports a stray closing brace as unbalanced_braces", () => {
    const content = "{{c1::a}b}}";
    const error = runStrictError(content);

    assert.strictEqual(error.issues[0]!.reason, "unbalanced_braces");
    assert.strictEqual(error.issues[0]!.start, 0);
    assert.strictEqual(error.issues[0]!.end, content.indexOf("}") + 1);
    assert.strictEqual(error.issues[0]!.fragment, "{{c1::a}");
  });

  it("reports a missing cloze index", () => {
    const content = "Note {{c::answer}} here";
    const error = runStrictError(content);

    assert.strictEqual(error.issues[0]!.reason, "missing_index");
    assert.strictEqual(error.issues[0]!.start, content.indexOf("{{c::"));
    assert.strictEqual(error.issues[0]!.fragment, "{{c::");
  });

  it("reports a malformed cloze index", () => {
    const content = "{{c1a::answer}}";
    const error = runStrictError(content);

    assert.strictEqual(error.issues[0]!.reason, "malformed_index");
    assert.strictEqual(error.issues[0]!.start, 0);
    assert.strictEqual(error.issues[0]!.fragment, "{{c1a::");
  });

  it("reports a non-digit index that still uses the cloze delimiter", () => {
    for (const [content, fragment] of [
      ["{{c-1::answer}}", "{{c-1::"],
      ["{{cx::answer}}", "{{cx::"],
      ["{{c_1::answer}}", "{{c_1::"],
    ] as const) {
      const error = runStrictError(content);
      assert.strictEqual(error.issues[0]!.reason, "malformed_index");
      assert.strictEqual(error.issues[0]!.start, 0);
      assert.strictEqual(error.issues[0]!.fragment, fragment);
    }
  });

  it("reports a missing :: separator", () => {
    const content = "{{c1:answer}}";
    const error = runStrictError(content);

    assert.strictEqual(error.issues[0]!.reason, "missing_separator");
    assert.strictEqual(error.issues[0]!.start, 0);
    assert.strictEqual(error.issues[0]!.fragment, "{{c1:");
  });

  it("reports a missing separator when the index is not followed by a colon", () => {
    const content = "{{c1}}";
    const error = runStrictError(content);

    assert.strictEqual(error.issues[0]!.reason, "missing_separator");
    assert.strictEqual(error.issues[0]!.start, 0);
    assert.strictEqual(error.issues[0]!.fragment, "{{c1");
  });

  it("does not ignore a malformed cloze when another valid cloze exists", () => {
    const content = "The {{c1::Paris}} is {{c2::unfinished";
    const error = runStrictError(content);

    assert.ok(error instanceof ClozeSyntaxError);
    assert.strictEqual(error.issues.length, 1);
    assert.strictEqual(error.issues[0]!.reason, "unclosed");
    assert.strictEqual(error.issues[0]!.start, content.indexOf("{{c2::"));
    assert.ok(parseClozeDeletions(content).length === 1);
  });

  it("reports every malformed cloze in the same content", () => {
    const content = "{{c::one}} and {{c2:two}}";
    const error = runStrictError(content);

    assert.strictEqual(error.issues.length, 2);
    assert.strictEqual(error.issues[0]!.reason, "missing_index");
    assert.strictEqual(error.issues[0]!.start, 0);
    assert.strictEqual(error.issues[1]!.reason, "missing_separator");
    assert.strictEqual(error.issues[1]!.start, content.indexOf("{{c2:"));
  });

  it("includes a stable reason in the human-readable message without requiring message parsing", () => {
    const error = runStrictError("{{c1::unfinished");

    assert.strictEqual(error.issues[0]!.reason, "unclosed");
    assert.ok(error.issues[0]!.message.includes("Unclosed cloze deletion"));
    assert.ok(error.issues[0]!.message.includes("starting at character 0"));
  });
});

describe("math-context-aware replacement", () => {
  it("marks cloze inside inline math as insideMath", () => {
    const contexts: boolean[] = [];
    replaceClozeDeletionsWithContext("$E = {{c1::mc^2}}$", (d) => {
      contexts.push(d.insideMath);
      return d.hidden;
    });

    assert.deepStrictEqual(contexts, [true]);
  });

  it("marks cloze outside math as not insideMath", () => {
    const contexts: boolean[] = [];
    replaceClozeDeletionsWithContext("The {{c1::answer}} is here.", (d) => {
      contexts.push(d.insideMath);
      return d.hidden;
    });

    assert.deepStrictEqual(contexts, [false]);
  });

  it("distinguishes math and non-math clozes in same content", () => {
    const contexts: boolean[] = [];
    replaceClozeDeletionsWithContext("The {{c1::capital}} of $E = {{c2::mc^2}}$", (d) => {
      contexts.push(d.insideMath);
      return d.hidden;
    });

    assert.deepStrictEqual(contexts, [false, true]);
  });

  it("detects cloze inside display math", () => {
    const contexts: boolean[] = [];
    replaceClozeDeletionsWithContext("$$E = {{c1::mc^2}}$$", (d) => {
      contexts.push(d.insideMath);
      return d.hidden;
    });

    assert.deepStrictEqual(contexts, [true]);
  });

  it("handles escaped dollar sign before cloze", () => {
    const contexts: boolean[] = [];
    replaceClozeDeletionsWithContext("Price is \\$5, answer: {{c1::yes}}", (d) => {
      contexts.push(d.insideMath);
      return d.hidden;
    });

    assert.deepStrictEqual(contexts, [false]);
  });

  it("handles cloze with braces inside math context", () => {
    const contexts: boolean[] = [];
    replaceClozeDeletionsWithContext("$\\frac{1}{{{c1::x^{2}}}}$", (d) => {
      contexts.push(d.insideMath);
      return d.hidden;
    });

    assert.deepStrictEqual(contexts, [true]);
  });

  it("handles cloze in inline code (not math)", () => {
    const contexts: boolean[] = [];
    replaceClozeDeletionsWithContext("`$not math$` and {{c1::answer}}", (d) => {
      contexts.push(d.insideMath);
      return d.hidden;
    });

    assert.deepStrictEqual(contexts, [false]);
  });

  it("produces correct replacement string for mixed contexts", () => {
    const output = replaceClozeDeletionsWithContext(
      "The {{c1::capital}} of $E = {{c2::mc^2}}$",
      (d) => (d.insideMath ? `\\text{[...]}` : `**[...]**`),
    );

    assert.strictEqual(output, "The **[...]** of $E = \\text{[...]}$");
  });

  it("returns input unchanged when no clozes present", () => {
    const input = "$E = mc^2$";
    const output = replaceClozeDeletionsWithContext(input, () => "[x]");
    assert.strictEqual(output, input);
  });

  it("handles multiple math spans correctly", () => {
    const contexts: boolean[] = [];
    replaceClozeDeletionsWithContext("${{c1::a}}$ then {{c2::b}} then ${{c3::c}}$", (d) => {
      contexts.push(d.insideMath);
      return d.hidden;
    });

    assert.deepStrictEqual(contexts, [true, false, true]);
  });

  it("does not treat $5 dollar amounts as math spans", () => {
    const contexts: boolean[] = [];
    replaceClozeDeletionsWithContext("This costs $5 and {{c1::answer}}", (d) => {
      contexts.push(d.insideMath);
      return d.hidden;
    });

    assert.deepStrictEqual(contexts, [false]);
  });

  it("does not let $ inside cloze body poison math detection", () => {
    const contexts: boolean[] = [];
    replaceClozeDeletionsWithContext("Price is {{c1::$5}} and $x = {{c2::2}}$", (d) => {
      contexts.push(d.insideMath);
      return d.hidden;
    });

    assert.deepStrictEqual(contexts, [false, true]);
  });

  it("handles multi-backtick code spans", () => {
    const contexts: boolean[] = [];
    replaceClozeDeletionsWithContext("``$x$`` and {{c1::answer}}", (d) => {
      contexts.push(d.insideMath);
      return d.hidden;
    });

    assert.deepStrictEqual(contexts, [false]);
  });

  it("rejects space-flanked $ as math (flanking rules)", () => {
    const contexts: boolean[] = [];
    replaceClozeDeletionsWithContext("$ not math $ and {{c1::answer}}", (d) => {
      contexts.push(d.insideMath);
      return d.hidden;
    });

    assert.deepStrictEqual(contexts, [false]);
  });

  it("does not let unclosed $$ fall through to inline $", () => {
    const contexts: boolean[] = [];
    replaceClozeDeletionsWithContext("$$unclosed and $x = {{c1::2}}$", (d) => {
      contexts.push(d.insideMath);
      return d.hidden;
    });

    assert.deepStrictEqual(contexts, [true]);
  });
});
