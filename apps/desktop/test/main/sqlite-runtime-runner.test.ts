import { Cause, Data, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  type RuntimeRunner,
  runSqlInRuntime,
  runSqlInRuntimeOrMapRuntimeError,
} from "@main/sqlite/runtime-runner";

class DomainError extends Data.TaggedError("DomainError")<{
  readonly message: string;
}> {}

class RuntimeBridgeError extends Data.TaggedError("RuntimeBridgeError")<{
  readonly message: string;
}> {}

const makeRuntime = (): RuntimeRunner<never> => ({
  runPromise: (effect) => Effect.runPromise(effect),
});

describe("sqlite runtime runner", () => {
  it("runs an effect successfully", async () => {
    const runtime = makeRuntime();

    const value = await Effect.runPromise(
      runSqlInRuntime({
        runtime,
        effect: Effect.succeed(1),
      }),
    );

    expect(value).toBe(1);
  });

  it("preserves typed failures from the inner effect", async () => {
    const runtime = makeRuntime();

    const exit = await Effect.runPromiseExit(
      runSqlInRuntime({
        runtime,
        effect: Effect.fail(
          new DomainError({
            message: "expected domain failure",
          }),
        ),
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag !== "Some") return;

    expect(failure.value).toBeInstanceOf(DomainError);
    if (!(failure.value instanceof DomainError)) return;
    expect(failure.value.message).toBe("expected domain failure");
  });

  it("maps runtime defects to a domain error", async () => {
    const runtime: RuntimeRunner<never> = {
      runPromise: () => Promise.reject(new Error("boom")),
    };

    const exit = await Effect.runPromiseExit(
      runSqlInRuntimeOrMapRuntimeError({
        runtime,
        effect: Effect.succeed("ok"),
        mapRuntimeError: (error) =>
          new RuntimeBridgeError({
            message: String(error),
          }),
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag !== "Some") return;

    expect(failure.value).toBeInstanceOf(RuntimeBridgeError);
    if (!(failure.value instanceof RuntimeBridgeError)) return;
    expect(failure.value.message).toContain("boom");
  });

  it("surfaces runtime rejections as failures in runSqlInRuntime", async () => {
    const runtime: RuntimeRunner<never> = {
      runPromise: () => Promise.reject(new Error("runtime down")),
    };

    const exit = await Effect.runPromiseExit(
      runSqlInRuntime({
        runtime,
        effect: Effect.succeed("ok"),
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag !== "Some") return;

    expect(String(failure.value)).toContain("UnknownException");
    expect(String((failure.value as { error?: unknown }).error)).toContain("runtime down");
  });

  it("treats defects as runtime-level failures in runSqlInRuntime", async () => {
    const runtime = makeRuntime();

    const exit = await Effect.runPromiseExit(
      runSqlInRuntime({
        runtime,
        effect: Effect.dieMessage("defect boom"),
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag !== "Some") return;

    expect(String(failure.value)).toContain("UnknownException");
    expect(String((failure.value as { error?: unknown }).error)).toContain("defect boom");
  });
});
