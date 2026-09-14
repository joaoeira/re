# GPUIX comment-popover positioning research

Research date: 2026-09-14. Scope: establish the implementation path for a new positioning playground in the Overlay app, before building the page.

## Conclusion

Use GPUI's native layout and deferred drawing as the foundation. GPUIX 0.7.0 already follows an anchor through scrolling, paints floating content above its ancestors, and provides a growing, internally scrolling native textarea. It does **not** expose the rectangle-aware flipping, available-space sizing, clipping-boundary selection, or stable placement policy needed by the Comment lifecycle design.

Two failures were reproduced through the app's actual patched native module: both stock fitting modes can cover the reference card near the window edge; a textarea's outer `maxHeight` can shrink without shrinking its inner editor viewport, allowing text to paint outside the background.

Recommendation: build a small native positioning primitive plus a React playground, rather than drive positioning from repeatedly queried, last-painted bounds. Keep the scope to the capabilities this interaction requires; claiming general Floating UI parity would require substantially more coverage.

## Version and app integration

- `apps/overlay/package.json`: React 19.2.3, `@gpuix/react` 0.7.0, Bun runtime.
- `apps/overlay/scripts/build-gpuix.ts`: source revision `a24b4a42eb516c7b940eb8d34ecebb077df623bd`; embedded GPUI fork revision `8b94defe56992b3ca4ffd4853ace741d8168111a` in the local checkout.
- Native sources are available at `apps/overlay/.cache/gpuix-0.7.0`. The caret patch is applied there and the native binary is copied into `apps/overlay/dist`.
- `patches/@gpuix%2Freact@0.7.0.patch` already fixes floating backing-surface colors and corners. Preserve it.
- `src/window.tsx` creates a 720 × 465 resizable native window with a 300 × 232.5 minimum. `src/panel.ts` and `native/panel.m` provide AppKit behavior. The custom frame loop uses `panel.pump`, not the ordinary GPUIX renderer tick.
- `src/app.tsx` owns screen state and keyboard handling. Its renderer prop currently exposes only focus traversal. `src/launch.ts` deliberately restricts external launch routes to create/review.
- `src/screens/shell.tsx` has the left rail, footer and an overlays slot. The footer is an application exclusion area, distinct from the native window edge.
- `src/ui/field.tsx` fixes `minRows` and `maxRows` to the same count. A comment editor must use different limits.
- `src/ui/dropdown.tsx` and the combobox already use GPUIX floating controls. There is no need to borrow their selection semantics for a comment editor.
- `scripts/screens.tsx`, `src/screens/catalog.tsx` and `test/card-markdown.test.tsx` demonstrate real native rendering and geometry assertions.

The app already renders study cards, but does not have the proposed candidate-card/comment interaction. The playground should use a trivial fixture card and avoid deck loading, scheduling, generation, and persistence.

## What native anchoring actually does

Read `packages/native/src/custom_elements/anchored.rs` in the pinned source. With no explicit `position`, it creates a zero-size, absolute wrapper on an edge of its containing element. `side="bottom" align="end"` selects the bottom-right point. This means placing it within a relative card wrapper gives the desired **card** anchor even though the icon is elsewhere in that card.

The popup content is wrapped in GPUI `anchored()` and then `deferred()`. Deferred drawing retains the element offset and dispatch ancestry, but paints later. It is not a browser portal, nor a separate OS window. GPUI's deferred path uses no additional content mask here, allowing content outside a scrolling ancestor's clip. `priority` orders deferred layers; `occlude` prevents hits on covered controls. Opaque fills matter on the app's blurred Metal surface.

Read the pinned GPUI `zed/crates/gpui/src/elements/anchored.rs`, especially `prepaint`:

1. Child layout produces the floating content's size.
2. A point plus a popup anchor corner produces its initial bounds.
3. `fit="snap"` translates overflowing edges into the **window**.
4. `fit="switch"` first tries another popup corner around the **same point**, then snaps if necessary.

Neither operation knows the full card rectangle. Switching the popup corner around the card's bottom edge does not move the anchor to the card's top edge. It can cover the card exactly. `snapMargin` is applied when snapping actual overflow, rather than reserving an unconditional padded collision rectangle. It does not provide footer-aware collision handling.

The React `FloatingLayer` hardcodes `fit="snap"`; changing between the existing Select/Combobox/Tooltip wrappers will not solve these gaps. Upstream main was also inspected: its anchored wrapper retains the same point-based fitting model, so there is no evident ready-made rectangle-aware replacement to obtain by upgrading.

## Reproduced behavior

Run `bun apps/overlay/scripts/research-positioning.tsx`. It uses the same patched native module as the app and prints actual GPUI bounds. It is a diagnostic probe, not a regression suite claiming the missing behavior passes. Screenshots go to `apps/overlay/dist/positioning-research`.

Window: 720 × 465. Reference: x=160, width=440, height=100. Popup: width=340, height=100. Gap: 8.

| Case                        | Card top/bottom | Popup top/bottom | Finding                             |
| --------------------------- | --------------- | ---------------- | ----------------------------------- |
| Bottom, snap, enough room   | 80 / 180        | 188 / 288        | Correct 8px gap and right alignment |
| Bottom, snap, near bottom   | 330 / 430       | 353 / 453        | Popup overlaps card                 |
| Bottom, switch, near bottom | 330 / 430       | 330 / 430        | Popup covers card vertically        |
| Explicit top, near bottom   | 330 / 430       | 222 / 322        | Correct placement above card        |
| Explicit top, near top      | 20 / 120        | 8 / 108          | Snap again overlaps card            |

A scrolling-parent probe moved the card from y=80 to y=40 and the popup from y=188 to y=148 with no React coordinate calculation. Native positioning follows scrolling correctly in this ordinary scroll-container case. The popup extends outside that container's 200px viewport; native source confirms deferred clipping behavior. Virtualized-anchor disappearance is not covered by this probe.

Textarea with `minRows=1`, `maxRows=4`, and 8px padding measured 42px for one line, 94px for three lines, and 120px for both twelve explicit lines and long wrapped content. Do not infer the actual row height from a CSS-looking style alone: use measured native layout. This fixture produced a 26px editor line height.

With `maxHeight=70`, the textarea's recorded outer height becomes 70, but the screenshot shows lower lines below its background. The native `EditorTextElement::request_layout` clamps content height to row counts; its separate inner layout/scroll viewport does not automatically adopt the outer box's max-height constraint. Hiding overflow alone would conceal text without establishing the correct scrolling viewport.

A two-row native textarea in a deferred overlay scrolled from the final lines toward earlier lines while the parent scroll offset stayed `[0,0]`. Screenshots confirm the text moved. This supports retaining the native textarea's own wheel handling; it does not establish that arbitrary nested GPUIX scroll containers work.

## Geometry ownership and bridge limitations

The public ref is an `{id, type, props}` instance, not a DOM element. There is no `getBoundingClientRect`, `ResizeObserver`, browser portal, or React `onLayout` event in the installed host surface.

The live renderer does expose `getElementBounds`, `getWindowSize`, `getWindowInsets`, and scroll APIs. However, `getElementBounds` reads automation bounds recorded during **paint**, after layout/prepaint. The bounds map intentionally represents the most recently painted frame, not the current layout being decided. Using it to position a popup through React adds a feedback cycle: paint → query → React mutation → later layout. That needs explicit lifecycle/invalidation handling and can lag scrolling or growth.

`onScroll` on an ordinary div is a wheel-event notification, not an exhaustive geometry-change subscription. It does not substitute for changes caused by resizing, sibling reflow, programmatic scrolling, or native editor layout. Adding a JavaScript timer would make a demo possible, but would not prove the desired native quality.

There is another important distinction: the card's **visibility boundary** is the intersection of its scrolling ancestors; the popup's **collision boundary** is the usable window area. Escaping the scroller's clip is desirable for the popup. Continuing to display it after its anchor is fully clipped is not.

## Recommended native design

Extend GPUIX with a reference-aware floating element or pair of elements. Prefer an explicit reference wrapper and floating child/slot so the primitive has access to the card's bounds during the current native frame. The existing custom-element context supplies built children; it does not already supply arbitrary reference rectangles. The precise wrapper/slot API needs an implementation spike.

The primitive needs these inputs: preferred side/alignment, gap, collision padding, usable boundary/insets, preferred width, design height cap, and the full reference rectangle. It should keep resolved side while open and expose resolved placement/available space for diagnostics. Application comment data remains in React.

In native layout/prepaint:

1. Establish reference bounds and its effective clipping region. If fully hidden, suppress floating paint/hit-testing and notify the application to dismiss while preserving text.
2. Resolve popup width against reference width and usable window width.
3. Measure desired content height at that width, independently of the previous constrained height.
4. Prefer below on opening; flip above if needed; when neither side fits, choose more room and constrain height.
5. Preserve the current side while it fits during editing. Do not alternate sides after constraining content and then measuring only that constrained size.
6. Re-layout the native editor to the actual available content height, leaving the save control outside the scrolling viewport. This is the sizing gap the probe exposed.
7. Right-align and shift horizontally within the boundary. Compute vertical position from the chosen card edge, never by translating the popup over the card.
8. Prepaint/paint in the deferred layer, with matching hitboxes and surface styling, in the same native frame.

GPUI permits custom measured layout and deferred prepaint, but the exact remeasurement implementation still needs prototyping. It should avoid modifying the automation bounds registry into a speculative layout registry: GPUI virtual lists may roll back prepaint work, which is precisely why the existing automation registry records paint.

At very small window sizes there may be no usable area above or below the card. No solver can simultaneously keep the whole card visible and fit a minimum editor in nonexistent space. The playground must exercise that condition; a compact dedicated editor is a reasonable fallback to choose, rather than silently violating geometry.

## Why not simply use Floating UI core?

`@floating-ui/core` is platform-independent and supports a custom platform adapter. That is a legitimate alternative, not a browser-only impossibility. It would still require reliable current reference/content/boundary measurements, dimension application, and geometry invalidation through the native bridge. The hard missing infrastructure is not the rectangle arithmetic. A native solver is the better initial fit for this app's existing frame/layout ownership. Reconsider a core adapter if a broader native measurement/subscription API is introduced.

## The proof-of-concept page

Add a local Positioning playground screen with one simple card in a bounded scroller, a clickable comment glyph, native textarea, and fixed footer. Provide controls to move the card near each edge, change its height, change the editor content, and reset the scene. Allow ordinary window resizing. Show the selected side, measured bounds and available height in a small diagnostic area; these are appropriate here because this is a technical playground.

Keep the playground distinct from external create/review launch intents: add an internal page selection and an Actions entry rather than widening Raycast/native routes unnecessarily. Use the shared theme and Shell. A small controller owns playground state; props-only view components fit the existing convention. Preserve native editor identity across placement changes so focus, selection and IME are not reset by a flip.

Prove these behaviors through the native test renderer and then in the actual app:

- Opening below/right-aligned without moving the card or following content.
- Flipping fully above the card with the same gap; retaining the side during typing/deletion.
- Horizontal shifts and wrapping after window narrowing.
- Growth to cap, constrained inner scrolling, and a visible save control.
- Following user and programmatic scrolling; no detached popup after the reference disappears.
- Respecting the footer boundary and very small windows.
- Correct overlay paint order, clipping escape, pointer occlusion, and editor-vs-parent wheel handling.
- Focus/selection surviving flips; outside dismissal retains text; Enter submits and Shift+Enter inserts a line break.

Native input already binds Enter to Submit and Shift+Enter to Newline; use `onSubmit`, not a browser-style key interception assumption. Root Escape handling must give the playground editor priority over hiding the app.

## Sources

App files and pinned native files above were read locally. Main/upstream links are supplementary and must not override the installed revision:

- [GPUIX upstream repository](https://github.com/remorses/gpuix)
- [Current anchored implementation](https://github.com/remorses/gpuix/blob/main/packages/native/src/custom_elements/anchored.rs)
- [Current floating wrapper](https://github.com/remorses/gpuix/blob/main/packages/react/src/components/floating.tsx)
- [Floating UI custom platform](https://floating-ui.com/docs/platform)

No app page or native dependency changes have been made in this research phase. The new diagnostic script and this report capture the findings for implementation.
