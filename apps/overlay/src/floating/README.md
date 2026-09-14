# Floating content

`Floating` positions arbitrary React content relative to another element. It uses
GPUI's current layout and deferred drawing; no JavaScript position polling or
last-painted bounds are involved.

```tsx
<Floating
  open={open}
  reference={<Card onCommentClick={() => setOpen(true)} />}
  width={340}
  maxHeight={180}
  boundaryInsets={{ bottom: 47 }}
  onClickOutside={() => setOpen(false)}
  onReferenceHidden={() => setOpen(false)}
>
  <textarea
    autoFocus
    value={draft}
    onChange={(event) => setDraft(event.value ?? "")}
    minRows={1}
    maxRows={8}
    style={{ minHeight: 0 }}
  />
</Floating>
```

The reference determines placement; its trigger can be anywhere within it. The
reference stays in normal flow. The popup does not push other content around.

## Contract

`side` is the opening preference (`bottom` by default). `align` is `start`,
`center`, or `end` (default). Defaults are a width of 340, maximum height of 180,
gap of 8, and `collisionPadding` of 12 logical pixels. `boundaryInsets` reserves
window edges occupied by other UI; collision padding is added inside those edges.

The native primitive resolves width before measuring natural height. It keeps
the current side while content fits there, otherwise tries the preferred side,
the opposite side, or the side with more room. It constrains height to that room
and shifts horizontally into the usable boundary. Closing resets the side.

The content is clipped to its allocated surface. It controls its own scrolling:
use `minHeight: 0` for shrinkable children, `overflowY: "scroll"` for an arbitrary
scrolling body, and `flexShrink: 0` for fixed header/footer actions. The native
textarea manages its own scrolling; do not wrap it in another scroll container.
`style` controls the surface appearance, but the component owns its layout,
clipping and pointer occlusion properties.

`onClickOutside` means outside the popup surface, including the reference. It
does not discard content state. `onReferenceHidden` reports that the reference
is clipped out of view or outside the usable boundary; the consumer should close
the popup and retain any draft. If the caller keeps it open, it becomes visible
again when the reference returns. An empty usable boundary suppresses drawing.

Content identity survives resizing and flips, preserving editor focus and
selection. This primitive does not manage focus restoration, Escape, saved text,
or form submission. A textarea already exposes native `onSubmit` for Enter and
uses Shift+Enter for a newline.

## Where to read the implementation

- `floating.tsx`: the public contract and two child slots. The internal `change`
  event carries reference visibility notification through GPUIX's existing bridge.
- `apps/overlay/native/floating/geometry.rs`: pure
  rectangle placement policy, with no editor or React concepts.
- `apps/overlay/native/floating/mod.rs`: native prop decoding, reference layout,
  two-pass content measurement and deferred painting. The second layout reuses
  the child layout ID; it does not rebuild or remount the content.
- `apps/overlay/native/gpuix-editor-viewport.patch`: ensures the editor's inner
  scrolling viewport respects allocated height instead of just its row cap.

The native sources are ordinary checked-in Rust files, copied by `build-gpuix.ts`
into the pinned renderer checkout. Only registration and the existing editor
require patches. Edit the checked-in files, not `.cache/gpuix-0.7.0`; rebuilding
regenerates patched upstream files and replaces the owned extension directory.

## Scope

This version supports top/bottom placement in one native window. It does not
provide left/right placement, nested popup priority management, pointer anchors,
arrows, animations, virtualized-reference lifecycle, or a minimum-height fallback
editor. Very cramped space can produce a viewport smaller than a text line; a
consumer that requires a minimum working area must offer a different layout.
These are explicit limits rather than extra flags in the current API.

## Validation

Run `bun run --cwd apps/overlay test:positioning`. This rebuilds the native module
when sources change, then exercises the public React component through real GPUI
layout, drawing, hit-testing, focus, keyboard input and scrolling. Do not run the
test file against an older native binary after editing Rust.

The tests cover card-aware flipping, boundary constraints, empty space, native
editor growth/focus/side stability, usable inner height above a fixed action,
scroll routing, generic action hit-testing, and reference disappearance. They do
not import the solver or assert its internal steps.

Sensitivity was checked during implementation: the first flip test failed
against stock anchored snapping; the constrained-editor test inserted into
`three` instead of the visible final `six`; and disabling side retention made
the shortening test fail (bottom 374 instead of 232). The mutations were removed.
