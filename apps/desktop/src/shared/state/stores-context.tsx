import { createContext, useContext } from "react";
import { createDeckListStore, type DeckListStore } from "./deckListStore";
import { createDeckSelectionStore, type DeckSelectionStore } from "./deckSelectionStore";

type Stores = {
  readonly deckList: DeckListStore;
  readonly deckSelection: DeckSelectionStore;
};

const StoresContext = createContext<Stores | null>(null);

function useStores(): Stores {
  const stores = useContext(StoresContext);
  if (!stores) throw new Error("StoresProvider is missing from the component tree");
  return stores;
}

export function useDeckListStore(): DeckListStore {
  return useStores().deckList;
}

export function useDeckSelectionStore(): DeckSelectionStore {
  return useStores().deckSelection;
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
    deckList: createDeckListStore(),
    deckSelection: createDeckSelectionStore(),
  };
}
