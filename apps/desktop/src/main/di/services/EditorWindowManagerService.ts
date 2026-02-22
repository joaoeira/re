import { Context, Effect, Layer } from "effect";

import type { EditorWindowParams } from "@main/editor-window";

export type OpenEditorWindow = (params: EditorWindowParams) => void;

const noOpOpenEditorWindow: OpenEditorWindow = () => undefined;

export interface EditorWindowManagerService {
  readonly openEditorWindow: OpenEditorWindow;
  readonly bindOpenEditorWindow: (openEditorWindow: OpenEditorWindow) => void;
}

export const EditorWindowManagerService = Context.GenericTag<EditorWindowManagerService>(
  "@re/desktop/main/EditorWindowManagerService",
);

export const makeEditorWindowManagerBridgeService = (): EditorWindowManagerService => {
  let currentOpenEditorWindow: OpenEditorWindow = noOpOpenEditorWindow;

  return {
    openEditorWindow: (params) => currentOpenEditorWindow(params),
    bindOpenEditorWindow: (openEditorWindow) => {
      currentOpenEditorWindow = openEditorWindow;
    },
  };
};

export const EditorWindowManagerBridgeLive = Layer.effect(
  EditorWindowManagerService,
  Effect.sync(makeEditorWindowManagerBridgeService),
);

export const EditorWindowManagerServiceLive = (openEditorWindow: OpenEditorWindow) =>
  Layer.succeed(EditorWindowManagerService, {
    openEditorWindow,
    bindOpenEditorWindow: () => undefined,
  });
