# Chat: where to make changes

Start with [`../screens/chat-screen.tsx`](../screens/chat-screen.tsx) for the UI
contract and [`backend.ts`](backend.ts) for the server contract. The UI consumes
plain state and callbacks; OpenCode types stay inside the adapter and its setup.
There is no second chat database or separate Effect runtime.

## File map

| Responsibility                                                       | File                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------ |
| State, messages, normalized events, and text merging                 | [`model.ts`](model.ts)                                       |
| Effect service contract and expected errors                          | [`backend.ts`](backend.ts)                                   |
| OpenCode discovery, SDK calls, and event/snapshot conversion         | [`opencode.ts`](opencode.ts)                                 |
| App-owned directory, agent configuration, and context plugin         | [`opencode-directory.ts`](opencode-directory.ts)             |
| Sending, reconnecting, session/model changes, and response lifecycle | [`store.ts`](store.ts)                                       |
| Cancellable Promise actions and UI subscription delivery             | [`bridge.ts`](bridge.ts)                                     |
| React subscription and picker state                                  | [`use-chat.ts`](use-chat.ts)                                 |
| Shared runtime wiring and shutdown                                   | [`../workspace.ts`](../workspace.ts)                         |
| Navigation, shortcuts, footer commands, and callback wiring          | [`../app.tsx`](../app.tsx)                                   |
| Screen composition and public props                                  | [`../screens/chat-screen.tsx`](../screens/chat-screen.tsx)   |
| History/model controls, transcript/Stop, and composer/recovery       | [`../screens/chat/`](../screens/chat/)                       |
| Colors and typography                                                | [`../theme.ts`](../theme.ts), `chatTheme`                    |
| Native design fixtures                                               | [`../screens/chat-catalog.tsx`](../screens/chat-catalog.tsx) |

The private view sections take subsets of `ChatScreenProps`. Keep state transitions
in the store rather than adding SDK calls or workspace imports to those views.
Keep the adapter's SDK-to-app conversion beside its calls so SDK upgrades have one
place to reconcile response shapes. Change the agent prompt or tool policy in
`opencode-directory.ts`, not in the UI.

## How a turn works

`app.tsx` invokes a bridge action. The bridge runs the store command in the shared
runtime. The store updates its `SubscriptionRef` and calls `ChatConnection`; the
OpenCode adapter implements that contract. Server events return through the same
store, then the bridge delivers complete state snapshots to `useChat`.

Commands and server events share one semaphore to preserve their ordering. This
synchronizes state updates; it does not allow users to queue prompts. `chatLocked`
is the common guard for drafting, sending, changing chats, and changing models.
Stop has a separate guard because it must remain available during a response.
A second semaphore serializes start/reconnect requests. Reconnect marks the UI as
connecting and interrupts the old worker before taking the command permit; putting
it behind that permit again would make a hung event handler block recovery.

## Behaviors to preserve

- A text part ending does not end the turn. Execution completion waits for idle
  and restores the saved snapshot before unlocking input.
- The private `recovery` record holds `pendingSend` and `pendingSession`, retaining caller-generated IDs across uncertain
  network results. Reconnect checks what the server accepted before retrying.
- A completed text part may overlap buffered deltas after restoration.
  `receiveText` must not append those deltas a second time.
- Stop cancels any admitted input as well as interrupting active execution.
- Changing screens removes the React observer, not the server subscription.
  Shutdown interrupts Chat's scoped work and cancels outstanding bridge requests
  before the card persistence drain. It does not stop the shared OpenCode daemon.
- An unreadable selection during reconnect is cleared while preserving the draft;
  a deleted session must not trap every reconnect. A definite request rejection
  keeps the connection usable and preserves the draft. Uncertain results require
  reconciliation before another send.
- A failed event refresh surfaces an error without killing the event subscription.
  The UI's disconnected state means reconciliation is required; the event stream
  can still be alive. A later successful completion restores readiness.
- Only complete UI snapshots may be coalesced. Do not move the bridge's sliding
  buffer onto the raw server-event stream, where dropped deltas would lose text.

## Storage and current scope

The app chooses `~/Library/Application Support/re-overlay/chat`. The directory
contains its OpenCode configuration and `.opencode/plugins/chat-agent.js`; the
shared OpenCode database stores conversations. History filters by directory and
agent. Credentials remain in OpenCode. Drafts are in memory only.

The plugin replaces coding context and removes tools for this conversational POC.
Agent permissions alone are not a replacement for that hook. Tool support would
require an explicit product decision about permissions and interactions first.

The visual reference is the minimal Chat boards in Paper's **Workbench
explorations** page: Ready to send, Agent working, Stop and recover, and Chats and
models. Preserve their header controls, quiet transcript, right-aligned user
bubbles, inline Stop, and locked composer. Card creation and the right pane remain
outside this POC.

## Verification

From the repository root, run `bun run check:overlay` for resolution, typechecking,
native build, and all Overlay tests. From `apps/overlay`, run
`bun test test/chat.test.ts test/chat-screen.test.tsx test/opencode-connection.test.ts` for the focused behavior
checks and `bun scripts/screens.tsx chat` to render the design fixtures. Native
checks require a current native build.

`chat.test.ts` drives a fake `ChatBackend` through public store/bridge behavior;
`chat-screen.test.tsx` exercises the real native input and Stop control. Preserve
those behavioral tests during refactors instead of adding assertions about file
boundaries or private helper calls. Compare rendered fixtures after UI changes;
a passing typecheck cannot establish fidelity to Paper.

`opencode-connection.test.ts` exercises the installed SDK against controlled HTTP
and SSE responses, including mixed reasoning/text content and typed rejections.
It pins the app's interpretation of ordinals as indices in the complete content
array. This is a compatibility fixture, not independent verification of every
server release; check that convention when upgrading OpenCode. Store tests use a
controlled clock for UI scheduling and a live clock for their wait deadlines.

The transcript builds one ordered list of messages and an optional activity row
before rendering. Activity placement belongs in `transcriptItems` in
`chat-transcript.tsx`; keep it out of the individual message renderers. The
recovery record stays private to the store and under the command semaphore,
because its pending requests are not UI state.
