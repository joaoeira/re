import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";

import { mapScanDecksErrorToError } from "@re/workspace";
import { mapSettingsErrorToError } from "@shared/settings";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";
import {
  isDefaultReviewSessionOptions,
  reviewSessionOptionsCacheKey,
  type ReviewSessionOptions,
} from "@shared/rpc/schemas/review";

export type ReviewDeckSelection = "all" | string[];

const DEFAULT_SNAPSHOT_OPTIONS = {
  includeHidden: false,
  extraIgnorePatterns: [],
} as const;

const resolveDeckPathFromRoot = (rootPath: string, relativePath: string): string => {
  const separator = rootPath.includes("\\") ? "\\" : "/";
  const normalizedRoot =
    rootPath.endsWith("/") || rootPath.endsWith("\\") ? rootPath.slice(0, -1) : rootPath;
  const normalizedRelative = relativePath.replace(/^[/\\]+/, "").replace(/[\\/]+/g, separator);
  return `${normalizedRoot}${separator}${normalizedRelative}`;
};

export function useReviewBootstrapQuery(decks: ReviewDeckSelection, options: ReviewSessionOptions) {
  const ipc = useIpc();
  const deckSelectionKey = useMemo(() => (decks === "all" ? "all" : decks.join("\u0000")), [decks]);
  const optionsKey = useMemo(() => reviewSessionOptionsCacheKey(options), [options]);

  const query = useQuery({
    queryKey: queryKeys.reviewBootstrap(deckSelectionKey, optionsKey),
    queryFn: async () => {
      const settings = await runIpcEffect(
        ipc.client.GetSettings().pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.fail(toRpcDefectError(rpcDefect)),
          ),
          Effect.mapError(mapSettingsErrorToError),
        ),
      );
      const rootPath = settings.workspace.rootPath;

      if (!rootPath) {
        throw new Error("No workspace configured. Set a workspace root path in settings.");
      }

      const snapshot = await runIpcEffect(
        ipc.client
          .GetWorkspaceSnapshot({
            rootPath,
            options: DEFAULT_SNAPSHOT_OPTIONS,
          })
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
            Effect.mapError(mapScanDecksErrorToError),
          ),
      );

      const absoluteByRelative = new Map(
        snapshot.decks.map((deckSnapshot) => [
          deckSnapshot.relativePath,
          deckSnapshot.absolutePath,
        ]),
      );

      const deckPaths =
        decks === "all"
          ? snapshot.decks.map((deckSnapshot) => deckSnapshot.absolutePath)
          : decks.map(
              (relativePath) =>
                absoluteByRelative.get(relativePath) ??
                resolveDeckPathFromRoot(rootPath, relativePath),
            );

      return runIpcEffect(
        ipc.client
          .BuildReviewQueue({
            deckPaths,
            rootPath,
            ...(isDefaultReviewSessionOptions(options) ? {} : { options }),
          })
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      );
    },
  });

  return {
    deckSelectionKey,
    optionsKey,
    query,
  };
}
