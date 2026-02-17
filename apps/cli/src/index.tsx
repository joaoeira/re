#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App";
import { ThemeProvider } from "./ThemeContext";

const renderer = await createCliRenderer();
createRoot(renderer).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);
