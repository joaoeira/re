<!-- effect-solutions:start -->

## Effect Best Practices

**Before implementing Effect features**, run `effect-solutions list` and read the relevant guide.

Topics include: services and layers, data modeling, error handling, configuration, testing, HTTP clients, CLIs, observability, and project structure.

**Effect Source Reference:** `~/.local/share/effect-solutions/effect`
Search here for real implementations when docs aren't enough.

<!-- effect-solutions:end -->

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

someEffect.pipe(Effect.mapError(mapError))
```

```ts
// DON'T — _tag string matching after escaping the Effect error channel
try {
  return await Effect.runPromise(someEffect);
} catch (error) {
  if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "not_found") {
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
)
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
        card_index_out_of_bounds: () => Effect.fail(new RecoverableCardLoadError("Card index out of bounds")),
      }),
    ),
  );
```

Errors not caught by `catchTags` fall through naturally — `read_error` in the example above becomes an unrecoverable rejection, which makes the intentional omission explicit and visible.

### When `mapError` is appropriate

`mapError` is fine for simple catch-all wrapping where every error maps to the same type:

```ts
// OK — uniform wrapping, no classification
someEffect.pipe(Effect.mapError((e) => new ApiError({ message: toErrorMessage(e) })))
```

The problem is specifically the classification variant: a function that receives `unknown` and uses an `instanceof` or `_tag` chain to sort errors into different buckets.
