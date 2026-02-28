export const defaultOnStreamFrame: NonNullable<Window["desktopApi"]["onStreamFrame"]> = () => {
  return () => undefined;
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
