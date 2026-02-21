import { Effect } from "effect";
import type { IpcMainHandle, Implementations } from "electron-effect-rpc/types";

import type { EditorWindowParams } from "@main/editor-window";
import type { SettingsRepository } from "@main/settings/repository";
import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";
import type { AppContract } from "@shared/rpc/contracts";

import { createEditorHandlers } from "./handlers/editor";
import { createReviewHandlers } from "./handlers/review";
import { createWorkspaceHandlers } from "./handlers/workspace";

export type AppEventPublisher = IpcMainHandle<AppContract>["publish"];
export type OpenEditorWindow = (params: EditorWindowParams) => void;

const noOpPublish = ((..._args: [unknown, unknown]) => Effect.void) as AppEventPublisher;
const noOpOpenEditorWindow: OpenEditorWindow = () => undefined;

export type AppRpcHandlers = {
  readonly handlers: Implementations<AppContract>;
  readonly markDuplicateIndexDirty: () => void;
};

export const createAppRpcHandlers = (
  settingsRepository: SettingsRepository,
  watcher: WorkspaceWatcher,
  publish: AppEventPublisher = noOpPublish,
  openEditorWindow: OpenEditorWindow = noOpOpenEditorWindow,
): AppRpcHandlers => {
  const editor = createEditorHandlers(settingsRepository, publish, openEditorWindow);
  const reviewHandlers = createReviewHandlers(settingsRepository);
  const workspaceHandlers = createWorkspaceHandlers(
    settingsRepository,
    watcher,
    editor.markDuplicateIndexDirty,
  );

  return {
    handlers: {
      ...workspaceHandlers,
      ...reviewHandlers,
      ...editor.handlers,
    },
    markDuplicateIndexDirty: editor.markDuplicateIndexDirty,
  };
};
