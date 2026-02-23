import { createContext, useContext, useEffect, useState } from "react";

import { createIpc } from "./ipc";

type Ipc = ReturnType<typeof createIpc>;

const IpcContext = createContext<Ipc | null>(null);

export function IpcProvider({ children }: { children: React.ReactNode }) {
  const [ipc, setIpc] = useState<Ipc | null>(null);

  useEffect(() => {
    const instance = createIpc(window.desktopApi);
    setIpc(instance);

    return () => {
      instance.dispose();
    };
  }, []);

  if (ipc === null) {
    return null;
  }

  return <IpcContext.Provider value={ipc}>{children}</IpcContext.Provider>;
}

export function useIpc(): Ipc {
  const ipc = useContext(IpcContext);
  if (!ipc) {
    throw new Error("IpcProvider is missing");
  }

  return ipc;
}
