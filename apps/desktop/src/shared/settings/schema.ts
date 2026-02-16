import { Schema } from "@effect/schema";

export const WorkspaceSettingsSchema = Schema.Struct({
  rootPath: Schema.Union(Schema.String.pipe(Schema.nonEmptyString()), Schema.Null),
});

export const SettingsSchemaV1 = Schema.Struct({
  settingsVersion: Schema.Literal(1),
  workspace: WorkspaceSettingsSchema,
});

export type Settings = typeof SettingsSchemaV1.Type;

export const DEFAULT_SETTINGS: Settings = {
  settingsVersion: 1,
  workspace: {
    rootPath: null,
  },
};

export const SetWorkspaceRootPathInputSchema = Schema.Struct({
  rootPath: Schema.Union(Schema.String.pipe(Schema.nonEmptyString()), Schema.Null),
});

export type SetWorkspaceRootPathInput = typeof SetWorkspaceRootPathInputSchema.Type;
