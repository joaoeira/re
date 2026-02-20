import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import "./styles.css";

import { router } from "./lib/router";
import { StoresProvider, createStores } from "@shared/state/stores-context";

const stores = createStores();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Renderer root element not found");
}

createRoot(root).render(
  <StrictMode>
    <StoresProvider stores={stores}>
      <RouterProvider router={router} />
    </StoresProvider>
  </StrictMode>,
);
