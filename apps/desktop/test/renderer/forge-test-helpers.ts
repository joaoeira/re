import { DEFAULT_SETTINGS } from "@shared/settings";

export const defaultOnStreamFrame: NonNullable<Window["desktopApi"]["onStreamFrame"]> = () => {
  return () => undefined;
};

export type ForgeDeckEntry = {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly name: string;
};

export const FORGE_WORKSPACE_ROOT_PATH = "/workspace";

export const DEFAULT_FORGE_DECKS: ReadonlyArray<ForgeDeckEntry> = [
  {
    absolutePath: `${FORGE_WORKSPACE_ROOT_PATH}/decks/alpha.md`,
    relativePath: "decks/alpha.md",
    name: "alpha",
  },
  {
    absolutePath: `${FORGE_WORKSPACE_ROOT_PATH}/decks/beta.md`,
    relativePath: "decks/beta.md",
    name: "beta",
  },
];

export const forgeSettingsSuccess = (rootPath: string | null = FORGE_WORKSPACE_ROOT_PATH) => ({
  type: "success" as const,
  data: {
    ...DEFAULT_SETTINGS,
    workspace: { rootPath },
  },
});

export const normalizeDeckRelativePath = (relativePath: string): string => {
  const trimmed = relativePath.trim().replace(/^[/\\]+/, "");
  return trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
};

export const toDeckEntry = (rootPath: string, relativePath: string): ForgeDeckEntry => {
  const normalizedRelativePath = normalizeDeckRelativePath(relativePath);
  const deckName = normalizedRelativePath.split("/").pop()?.replace(/\.md$/i, "") ?? "deck";
  return {
    absolutePath: `${rootPath}/${normalizedRelativePath}`,
    relativePath: normalizedRelativePath,
    name: deckName,
  };
};

export const mockDesktopGlobals = (
  invoke: (...args: unknown[]) => Promise<unknown>,
  getPathForFile: (file: File) => string = (file) => `/forge/${file.name}`,
  subscribe: (...args: unknown[]) => () => void = () => () => undefined,
) => {
  Object.defineProperty(window, "desktopApi", {
    configurable: true,
    value: {
      invoke,
      subscribe,
      onStreamFrame: defaultOnStreamFrame,
    },
  });

  Object.defineProperty(window, "desktopHost", {
    configurable: true,
    value: {
      getPathForFile,
    },
  });
};

export const waitForFileInput = async (): Promise<HTMLInputElement> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const input = document.querySelector('input[type="file"]');
    if (input instanceof HTMLInputElement) return input;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for file input to appear.");
};

export const uploadPdf = async (name = "source.pdf") => {
  const input = await waitForFileInput();

  const transfer = new DataTransfer();
  transfer.items.add(new File(["%PDF"], name, { type: "application/pdf" }));
  Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event("change", { bubbles: true }));
};
