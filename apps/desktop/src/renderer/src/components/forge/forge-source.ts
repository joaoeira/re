import type { ForgeSourceInput, ForgeSessionSummary } from "@shared/rpc/schemas/forge";

import { forgeSourceCacheKey } from "@/lib/query-keys";

export type ForgeSelectedSource =
  | {
      readonly kind: "pdf";
      readonly sourceLabel: string;
      readonly sourceFilePath: string;
    }
  | {
      readonly kind: "text";
      readonly sourceLabel?: string;
      readonly text: string | null;
    };

export const createPdfSelectedSource = (input: {
  readonly sourceLabel: string;
  readonly sourceFilePath: string;
}): ForgeSelectedSource => ({
  kind: "pdf",
  sourceLabel: input.sourceLabel,
  sourceFilePath: input.sourceFilePath,
});

export const createTextSelectedSource = (input: {
  readonly sourceLabel?: string;
  readonly text: string;
}): ForgeSelectedSource => ({
  kind: "text",
  ...(input.sourceLabel ? { sourceLabel: input.sourceLabel } : {}),
  text: input.text,
});

export const forgeSelectedSourceFromSession = (
  session: ForgeSessionSummary,
): ForgeSelectedSource | null => {
  switch (session.sourceKind) {
    case "pdf":
      return session.sourceFilePath
        ? createPdfSelectedSource({
            sourceLabel: session.sourceLabel,
            sourceFilePath: session.sourceFilePath,
          })
        : null;
    case "text":
      return {
        kind: "text",
        sourceLabel: session.sourceLabel,
        text: null,
      };
  }
};

export const toForgeSourceInput = (source: ForgeSelectedSource | null): ForgeSourceInput | null => {
  if (!source) return null;

  switch (source.kind) {
    case "pdf":
      return {
        kind: "pdf",
        sourceFilePath: source.sourceFilePath,
      };
    case "text": {
      if (source.text === null) return null;
      const trimmedLabel = source.sourceLabel?.trim();
      return {
        kind: "text",
        text: source.text,
        ...(trimmedLabel ? { sourceLabel: trimmedLabel } : {}),
      };
    }
  }
};

export const forgeSelectedSourceCacheKey = (source: ForgeSelectedSource | null): string | null =>
  forgeSourceCacheKey(toForgeSourceInput(source));
