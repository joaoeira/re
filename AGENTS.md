<!-- effect-solutions:start -->

## Effect Best Practices

**Before implementing Effect features**, run `effect-solutions list` and read the relevant guide.

Topics include: services and layers, data modeling, error handling, configuration, testing, HTTP clients, CLIs, observability, and project structure.

**Effect Source Reference:** `~/.local/share/effect-solutions/effect`
Search here for real implementations when docs aren't enough.

<!-- effect-solutions:end -->

## Test quality

A test earns its place by pinning down a behavior someone could plausibly break: an outcome a caller depends on, an ordering that matters, a failure that must stay contained. It does not earn its place by restating the source in assertion form, by replaying the same decision through a second call site, or by checking that a getter returns what it was just given. The tell is what happens when the implementation changes. A good test survives any refactor that preserves behavior and fails on any change that alters it. A bad test breaks on every edit and catches nothing, and it teaches people to update it reflexively, which is worse than having no test at all.

Assert through public outputs, match on the fields that matter rather than the whole object, and write one test per distinct behavior rather than one per branch. Be suspicious of any parameter, return value, or export whose only consumer is a test, because that is the test dictating the design rather than verifying it. Either find a way to observe the behavior from outside or delete the test, and then remove the seam.

When a test is kept because it guards something subtle, prove that it does by breaking the code on purpose and watching it fail. Fewer tests that each mean something beat many that mean nothing, because a suite people trust is one they will actually read when it goes red.

## Effect service definitions

Always define service interfaces explicitly. Never let a service's public API be inferred from its implementation.

### The anti-pattern

```ts
// DON'T — inferred service shape from implementation
class Counter extends Effect.Service<Counter>()("app/Counter", {
  effect: Effect.gen(function* () {
    const state = new Map<string, number>();

    const increment = Effect.fn("Counter.increment")(function* (key: string, amount = 1) {
      const current = state.get(key) ?? 0;
      const next = current + amount;
      state.set(key, next);
      return next;
    });

    const reset = Effect.fn("Counter.reset")(function* (key: string) {
      state.delete(key);
    });

    return { increment, reset };
  }),
}) {}
```

This fails in three ways:

1. **Scannability**: to understand the service contract you must mentally execute the factory, skip past private state, and find the `return` object. In large services this makes the API invisible at a glance.
2. **Top-down design**: you cannot consume the service before its implementation exists. The orchestrator has to wait for the implementation to be authored before the inferred types become available.
3. **Type safety**: inferred types propagate implementation accidents globally. In the example above, `amount` has no explicit type annotation, and depending on the callback context TypeScript may infer `any` instead of `number`. With no explicit contract to check against, this `any` silently spreads to every consumer.

### What to do instead

Declare the interface as an explicit type parameter, separate from the implementation:

```ts
// DO — explicit interface, Context.GenericTag (current codebase pattern)
export interface Counter {
  readonly increment: (key: string, amount?: number) => Effect.Effect<number>;
  readonly reset: (key: string) => Effect.Effect<void>;
}

export const Counter = Context.GenericTag<Counter>("app/Counter");

export const CounterLive = Layer.effect(
  Counter,
  Effect.gen(function* () {
    const state = new Map<string, number>();
    return {
      increment: (key, amount = 1) =>
        Effect.sync(() => {
          const current = state.get(key) ?? 0;
          const next = current + amount;
          state.set(key, next);
          return next;
        }),
      reset: (key) =>
        Effect.sync(() => {
          state.delete(key);
        }),
    };
  }),
);
```

```ts
// DO — explicit interface, Effect.Service (class-based API)
class Counter extends Effect.Service<Counter>()("app/Counter", {
  effect: Effect.gen(function* () {
    const state = new Map<string, number>();
    return {
      increment: (key: string, amount?: number) =>
        Effect.sync(() => {
          const current = state.get(key) ?? 0;
          const next = current + (amount ?? 1);
          state.set(key, next);
          return next;
        }),
      reset: (key: string) =>
        Effect.sync(() => {
          state.delete(key);
        }),
    };
  }),
}) {
  // Explicit interface as the type parameter to Effect.Service<Counter>
  readonly increment!: (key: string, amount?: number) => Effect.Effect<number>;
  readonly reset!: (key: string) => Effect.Effect<void>;
}
```

The explicit interface acts as a rigid failsafe: if the implementation diverges from the contract, the compiler rejects it locally rather than silently degrading type safety across every consumer.

## Effect error handling

Do not write utility functions that inspect `_tag` strings or use `instanceof` cascades to classify Effect errors. This is a recurring mistake that looks reasonable but works against the library.

### The anti-pattern

```ts
// DON'T — manual error classification
const mapError = (error: unknown) => {
  if (error instanceof FooError) return new ApiFooError({ message: error.message });
  if (error instanceof BarError) return new ApiBarError({ message: error.message });
  return new ApiGenericError({ message: String(error) });
};

someEffect.pipe(Effect.mapError(mapError));
```

```ts
// DON'T — _tag string matching after escaping the Effect error channel
try {
  return await Effect.runPromise(someEffect);
} catch (error) {
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "not_found"
  ) {
    throw new RecoverableError(error.message);
  }
  throw error;
}
```

Both patterns erase the typed error channel to `unknown`, then manually reconstruct what Effect already knows. The `instanceof` cascade is fragile, grows linearly with every new error type, and the catch-based `_tag` matching throws away type safety entirely.

### What to do instead

Use `Effect.catchTags` where the error channel is typed. It is exhaustive, type-safe, and makes the handling of each error visible at the call site:

```ts
// DO — catchTags at the call site where error types are known
deckManager.readDeck(deckPath).pipe(
  Effect.catchTags({
    DeckNotFound: (e) => Effect.fail(new CardContentNotFoundError({ message: e.message })),
    DeckReadError: (e) => Effect.fail(new CardContentReadError({ message: e.message })),
    DeckParseError: (e) => Effect.fail(new CardContentParseError({ message: e.message })),
  }),
);
```

When crossing from Effect into Promise-land (e.g. for XState `fromPromise` actors), handle error classification inside the Effect pipeline before calling `runPromise`:

```ts
// DO — classify errors in the Effect pipeline, not in a try/catch after runPromise
const loadCard = async (input) =>
  Effect.runPromise(
    ipc.client.GetCardContent(input).pipe(
      Effect.catchTags({
        not_found: (e) => Effect.fail(new RecoverableCardLoadError(e.message)),
        parse_error: (e) => Effect.fail(new RecoverableCardLoadError(e.message)),
        card_index_out_of_bounds: () =>
          Effect.fail(new RecoverableCardLoadError("Card index out of bounds")),
      }),
    ),
  );
```

Errors not caught by `catchTags` fall through naturally — `read_error` in the example above becomes an unrecoverable rejection, which makes the intentional omission explicit and visible.

### When `mapError` is appropriate

`mapError` is fine for simple catch-all wrapping where every error maps to the same type:

```ts
// OK — uniform wrapping, no classification
someEffect.pipe(Effect.mapError((e) => new ApiError({ message: toErrorMessage(e) })));
```

The problem is specifically the classification variant: a function that receives `unknown` and uses an `instanceof` or `_tag` chain to sort errors into different buckets.
