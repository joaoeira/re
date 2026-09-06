# re Pocket — standalone GPUIX utility

A compact macOS card utility with separate Create and Review screens opened from
Raycast. React renders through GPUIX, Bun runs the app, and a small Objective-C
bridge supplies AppKit window behavior. No running re Desktop is required.

Requires Apple Silicon macOS, Bun, Rust 1.97.1, and Xcode with its Metal toolchain
(`xcodebuild -downloadComponent MetalToolchain`). The first build compiles a
patched GPUIX renderer and takes a few minutes; subsequent builds reuse it.

```sh
bun install
bun run overlay:dev
# Or build the standalone app:
bun run overlay:build
open 'apps/overlay/dist/re Pocket.app'
```

The bundle contains Bun, GPUIX's native module, and the panel bridge. It is a local
development build, not a signed/notarized distribution. Quit before rebuilding;
run one instance at a time.

## Raycast and window controls

Add `apps/overlay/raycast` to Raycast Settings → Extensions → Script Commands.
The **Create Card** and **Review Cards** commands open their respective screens;
there is no in-app screen switcher. Both delegate to `launch.sh`, which places an
atomic launch request in `~/Library/Application Support/re-pocket` before opening
the app, so they also work with a running or hidden instance.

The 720 × 465 window starts above other windows. Drag its top edge to reposition
it. The background is a dark translucent tint over native blur. **⌘ K** opens
Actions: toggle keeping the window on top, restart a review, close, or quit.
**Escape** closes an open menu first, then hides the window. **⌃ ⌥ ⌘ R** toggles
the window globally; the **re** menu-bar item offers Show and Quit. **⌘ Q** quits.
Drafts and review position survive hiding and screen changes, but not quitting.

## Cards and decks

Open the deck combobox and start typing to filter deck names by substring,
ignoring case. Arrow keys and Enter select a result; Escape cancels. Each opening
starts with an empty search. Card Type is a **Question and Answer / Cloze**
dropdown. If macOS requests Documents access, click Allow in its permission
prompt. Rebuilding this unsigned development app can cause macOS to ask again.
**⌘ Return** creates a card in the selected Markdown deck using the shared re
parser and deck manager. Cloze uses `{{c1::answer}}` syntax and supports multiple
indices. Invalid content retains the draft and reports an error.

Review loads new/due cards across the configured workspace using the shared queue
builder. **Space** reveals, then grades Good. After reveal, **1 / 2 / 3 / 4** grade
**Again / Hard / Good / Easy**; these numeric shortcuts are not shown in the UI.
Enter does not advance reviews, and held or modified review keys are ignored.
Grades update the source deck through its lock-safe metadata operation and FSRS
scheduler. Again also moves the card to the end of this short practice session;
it does not wait for its next scheduled due time. **Restart Review** reloads the
workspace queue. Unreadable decks/cards are reported as skipped.

A **Pocket scratch deck** is available for isolated card creation. Without a
configured workspace, Review uses scratch cards; with a workspace configured,
Review uses workspace cards only. Scratch grades are practice history, not FSRS.

Scratch cards and preferences live in:

```text
~/Library/Application Support/re-pocket/cards.json
~/Library/Application Support/re-pocket/preferences.json
```

`RE_POCKET_DATA` overrides the scratch JSON path and places preferences alongside
it. The Raycast launch request stays in the default support directory regardless.
Scratch/preferences writes use temporary files plus rename.

Review renders Markdown, deck-relative images, and LaTeX. Inline `$…$` / `$$…$$`,
multiline `$$` blocks, and fenced `math` or `latex` blocks use locally bundled
MathJax to generate SVGs. No browser or remote formula service is needed. Ordinary
Markdown stays in GPUIX's native renderer; paragraphs containing math or images
use native text and image elements. Images preserve their aspect ratio and fit
the window, with larger content available by scrolling. Broken images or formulas
show an error in place. Rendered media is cached under the system temporary folder.
The desktop app's rich editor and AI are outside this POC.

## Native integration

`native/panel.m` configures GPUI's window without replacing its class or delegate.
It supplies floating level, all-Spaces/full-screen-auxiliary flags, a global
hotkey and a status item. The app drains ready AppKit events
without blocking Bun, avoiding GPUIX 0.7.0's embedded tick stalling while hidden.
GPUI retains its existing drawing and display-link sources.

The Bun patch for `@gpuix/react@0.7.0` gives the native floating backing surface
the same fill and corner radius as its popup. This removes square corner wedges
behind rounded Select and Combobox menus. `bun install` reapplies the patch.

`scripts/build-gpuix.ts` pins GPUIX 0.7.0's source revision and applies
`native/gpuix-caret.patch`, backporting the upstream caret fix from
[`4bea2507`](https://github.com/remorses/gpuix/commit/4bea250745627d5ff4d8b9d8f7cfbc3eb85e5806).
The caret is centered in the line and sized to 75% of the font size. Source and
build artifacts stay in ignored `.cache` and `dist` directories. The app embeds
the resulting native module, so installed users need no Rust toolchain.

Review padding belongs to the inner content container. This prevents the native
scroll parent from adding a scroll range when a short card fits in the window.

## Known gaps and tests

Full-screen Spaces, multiple displays, and focus restoration still need hands-on
validation. GPUIX accessibility remains limited; memory and idle CPU have not been
benchmarked against re Desktop.

Run the review behavior and persisted scheduling regression checks with:

```sh
bun test apps/overlay/test
```
