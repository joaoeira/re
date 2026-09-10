import { createRenderer, createRoot, flushSync, startFrameLoop } from "@gpuix/react";
import { App, type AppEvents } from "./app";
import { loadCards, type Card } from "./cards";
import { toErrorMessage } from "./error-message";
import { takeLaunchRequest } from "./launch";
import { panel } from "./panel";
import { loadPreferences } from "./preferences";
import { cardsPath } from "./storage";
import { disposeWorkspace } from "./workspace";

const renderer = createRenderer();
renderer.init({
  title: "re Overlay",
  width: 720,
  height: 465,
  minWidth: 300,
  minHeight: 232.5,
  titlebarTransparent: true,
  windowBackground: "blurred",
  show: false,
  focus: false,
});
const shortcutStatus = panel.initialize();
if (shortcutStatus === -1) throw new Error("Could not find the GPUIX window.");
if (shortcutStatus !== 0)
  console.warn(`Global shortcut unavailable (${shortcutStatus}); use Raycast or the menu bar.`);

let initialCards: Card[] = [];
let loadFailure: string | undefined;
try {
  initialCards = loadCards();
} catch (error) {
  loadFailure = toErrorMessage(error);
}
// The entry point owns native events; React supplies the current screen's actions.
const events: AppEvents = {
  key: () => {},
  route: () => {},
  refresh: () => {},
  preferences: () => {},
};

const root = createRoot(renderer, { onKeyDown: (event) => flushSync(() => events.key(event)) });
flushSync(() =>
  root.render(
    <App
      renderer={renderer}
      events={events}
      onQuit={() => void shutdown()}
      initial={{
        screen: takeLaunchRequest() ?? "create",
        preferences: loadPreferences(),
        cards: initialCards,
        error: loadFailure,
      }}
    />,
  ),
);
const routeTimer = setInterval(() => {
  const route = panel.takeRoute();
  if (route === "quit") {
    void shutdown();
    return;
  }
  if (route === "refresh") flushSync(() => events.refresh());
  if (route === "preferences") flushSync(() => events.preferences());
  const screen = route === "create" || route === "review" ? route : takeLaunchRequest();
  if (!screen) return;
  flushSync(() => events.route(screen));
  panel.show();
}, 40);
const loop = startFrameLoop(
  { requiresTick: () => true, tick: panel.pump },
  {
    frameMs: 16,
    onTerminated: () => {
      void shutdown();
    },
  },
);
process.on("exit", () => {
  clearInterval(routeTimer);
  loop.stop();
  panel.dispose();
});
let quitting = false;
async function shutdown() {
  if (quitting) return;
  quitting = true;
  await disposeWorkspace();
  process.exit(0);
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
console.log(`re Overlay ready. Scratch cards: ${cardsPath}`);
