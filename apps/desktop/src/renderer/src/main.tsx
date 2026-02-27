import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import "./styles.css";

import { IpcProvider } from "./lib/ipc-context";
import { router } from "./lib/router";
import { StoresProvider, createStores } from "@shared/state/stores-context";
import { SettingsPageProvider } from "@/components/settings/settings-page-context";
import { createQueryClient } from "./lib/query-client";

const stores = createStores();
const queryClient = createQueryClient();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Renderer root element not found");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <IpcProvider>
        <SettingsPageProvider>
          <StoresProvider stores={stores}>
            <RouterProvider router={router} />
          </StoresProvider>
        </SettingsPageProvider>
      </IpcProvider>
    </QueryClientProvider>
  </StrictMode>,
);
