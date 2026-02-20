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

## XState stores with React context

Stores use `@xstate/store` with React context injection — never module-scoped singletons. This makes components testable with fresh store instances per test.

### Structure

- **Factory function**: each store module exports `createMyStore()` returning a `createStore(...)` call, plus a `MyStore` type alias
- **Context + hooks**: a single `stores-context.tsx` provides all stores via one `StoresProvider` and one hook per store (`useMyStore()`)
- **Provider at root**: app entry point creates stores with `createStores()` and wraps the router in `<StoresProvider stores={stores}>`

### Pattern

Store module (`myStore.ts`):
```ts
import { createStore } from "@xstate/store";

export const createMyStore = () =>
  createStore({
    context: { /* initial state */ },
    on: {
      someEvent: (context, event: { value: string }) => ({ ...context, value: event.value }),
    },
  });

export type MyStore = ReturnType<typeof createMyStore>;
```

Context (`stores-context.tsx`):
```tsx
import { createContext, useContext } from "react";
import { createMyStore, type MyStore } from "./myStore";

type Stores = { readonly my: MyStore };

const StoresContext = createContext<Stores | null>(null);

function useStores(): Stores {
  const stores = useContext(StoresContext);
  if (!stores) throw new Error("StoresProvider is missing");
  return stores;
}

export function useMyStore(): MyStore { return useStores().my; }

export function StoresProvider({ children, stores }: { children: React.ReactNode; stores: Stores }) {
  return <StoresContext.Provider value={stores}>{children}</StoresContext.Provider>;
}

export function createStores(): Stores {
  return { my: createMyStore() };
}
```

Component usage:
```tsx
const myStore = useMyStore();
const value = useSelector(myStore, (s) => s.context.value);
myStore.send({ type: "someEvent", value: "new" });
```

### Conventions

- **Event names**: camelCase (`setLoading`, `toggleDeck`, `clear`)
- **No singleton exports**: store modules export only the factory function and type
- **One hook per store**: `useWorkspaceStore()`, `useDeckListStore()`, `useDeckSelectionStore()`
- **Selectors in components**: use `useSelector(store, selector)` directly in the component, not wrapper hooks per field
- **Dependencies**: `@xstate/store`, `@xstate/store-react`, React

### Testing

Tests create fresh stores — no reset events needed:
```tsx
const stores = createStores();
const screen = await render(
  <StoresProvider stores={stores}>
    <ComponentUnderTest />
  </StoresProvider>
);
```

Assert store state directly when needed:
```ts
expect(stores.deckSelection.getSnapshot().context.selected).toHaveProperty("deck.md");
```

## Vitest browser mode

The desktop app uses Vitest 4 browser mode with headless Chromium for component tests. This runs tests in a real browser instead of jsdom.

### Setup

Config uses `test.projects` (NOT `test.workspace` which was removed in Vitest 4):
```ts
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", environment: "jsdom", exclude: ["test/**/*.browser.test.tsx"] } },
      {
        plugins: [react()],
        test: {
          name: "browser",
          include: ["test/**/*.browser.test.tsx"],
          browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: "chromium" }] },
        },
      },
    ],
  },
});
```

Dependencies: `@vitest/browser-playwright`, `vitest-browser-react`. Chromium installed via `npx playwright install chromium`.

### Test patterns

- **Rendering**: `import { render } from "vitest-browser-react"`
- **Assertions**: `await expect.element(screen.getByText("ok")).toBeVisible()` (NOT testing-library's `expect()`)
- **Absence checks**: `expect(screen.getByText("missing").query()).toBeNull()`
- **Interactions**: `import { userEvent } from "@vitest/browser/context"`
- **File naming**: `*.browser.test.tsx` (picked up by browser project, excluded from unit project)

### Gotchas

- **`getByText` substring matching**: `getByText("deck")` matches "new-deck" too. Use `{ exact: true }` or `getByRole("button", { name: "deck", exact: true })`.
- **`userEvent.click` on disabled elements**: `userEvent.click` waits for the element to be enabled, so it times out on disabled buttons. Use `element.element().click()` (native DOM click) instead when testing that disabled buttons don't fire callbacks.
- **Base UI Checkbox**: renders as `<span>`, not `<input>`. Uses `data-checked` and `data-indeterminate` attributes. May have zero dimensions without compiled CSS — use `element().click()` instead of `userEvent.click()`.
- **Tooltips**: portaled and lazy-rendered. Trigger hover before asserting content. `await expect.element()` retries automatically.
- **Router context**: components using `useNavigate` must be inside a `RouterProvider`. For isolated component tests, create a minimal router with `createRootRoute` + `createRouter`. Assert navigation via `router.state.location`.
- **`__screenshots__` folder**: generated on test failure. Gitignored — not tracked.
