import { createContext, useContext } from "react";
import { createWorkspaceStore, type WorkspaceStore } from "./workspaceStore";
import { createDeckListStore, type DeckListStore } from "./deckListStore";
import { createDeckSelectionStore, type DeckSelectionStore } from "./deckSelectionStore";
import { createEditorStore, type EditorStore } from "./editorStore";
import { createSettingsStore, type SettingsStore } from "./settingsStore";

type Stores = {
  readonly workspace: WorkspaceStore;
  readonly deckList: DeckListStore;
  readonly deckSelection: DeckSelectionStore;
  readonly editor: EditorStore;
  readonly settings: SettingsStore;
};

const StoresContext = createContext<Stores | null>(null);

function useStores(): Stores {
  const stores = useContext(StoresContext);
  if (!stores) throw new Error("StoresProvider is missing from the component tree");
  return stores;
}

export function useWorkspaceStore(): WorkspaceStore {
  return useStores().workspace;
}

export function useDeckListStore(): DeckListStore {
  return useStores().deckList;
}

export function useDeckSelectionStore(): DeckSelectionStore {
  return useStores().deckSelection;
}

export function useEditorStore(): EditorStore {
  return useStores().editor;
}

export function useSettingsStore(): SettingsStore {
  return useStores().settings;
}

export function StoresProvider({
  children,
  stores,
}: {
  children: React.ReactNode;
  stores: Stores;
}) {
  return <StoresContext.Provider value={stores}>{children}</StoresContext.Provider>;
}

export function createStores(): Stores {
  return {
    workspace: createWorkspaceStore(),
    deckList: createDeckListStore(),
    deckSelection: createDeckSelectionStore(),
    editor: createEditorStore(),
    settings: createSettingsStore(),
  };
}
