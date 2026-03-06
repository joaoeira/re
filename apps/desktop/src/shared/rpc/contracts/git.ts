import { Schema } from "@effect/schema";
import { rpc } from "electron-effect-rpc/contract";

import { GitSyncErrorSchema, GitSyncResultSchema, GitSyncSnapshotSchema } from "@shared/git";

const GitSyncInputSchema = Schema.Struct({
  rootPath: Schema.String,
});

export const GetGitSyncSnapshot = rpc(
  "GetGitSyncSnapshot",
  GitSyncInputSchema,
  GitSyncSnapshotSchema,
);

export const RunGitSync = rpc(
  "RunGitSync",
  GitSyncInputSchema,
  GitSyncResultSchema,
  GitSyncErrorSchema,
);
