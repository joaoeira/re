import type { ReactElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "vitest-browser-react";

import { IpcProvider } from "@/lib/ipc-context";
import { createQueryClient } from "@/lib/query-client";

export const renderWithIpcProviders = async (ui: ReactElement) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <IpcProvider>{ui}</IpcProvider>
    </QueryClientProvider>,
  );
