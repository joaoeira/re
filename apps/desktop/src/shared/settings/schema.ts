import { Schema } from "@effect/schema";

export const WorkspaceSettingsSchema = Schema.Struct({
  rootPath: Schema.Union(Schema.String.pipe(Schema.nonEmptyString()), Schema.Null),
});

export const SettingsSchemaV1 = Schema.Struct({
  settingsVersion: Schema.Literal(1),
  workspace: WorkspaceSettingsSchema,
});
export type SettingsV1 = typeof SettingsSchemaV1.Type;

export const AiSettingsSchema = Schema.Struct({
  defaultModelKey: Schema.Union(Schema.String.pipe(Schema.nonEmptyString()), Schema.Null),
  promptModelOverrides: Schema.Record({
    key: Schema.String.pipe(Schema.nonEmptyString()),
    value: Schema.String.pipe(Schema.nonEmptyString()),
  }),
});

export const SettingsSchemaV2 = Schema.Struct({
  settingsVersion: Schema.Literal(2),
  workspace: WorkspaceSettingsSchema,
  ai: AiSettingsSchema,
});
export type SettingsV2 = typeof SettingsSchemaV2.Type;
export type Settings = SettingsV2;

export const DEFAULT_SETTINGS: Settings = {
  settingsVersion: 2,
  workspace: {
    rootPath: null,
  },
  ai: {
    defaultModelKey: null,
    promptModelOverrides: {
      "forge/reformulate-card": "openai/gpt-5.4",
    },
  },
};

export const SetWorkspaceRootPathInputSchema = Schema.Struct({
  rootPath: Schema.Union(Schema.String.pipe(Schema.nonEmptyString()), Schema.Null),
});

export type SetWorkspaceRootPathInput = typeof SetWorkspaceRootPathInputSchema.Type;

export const SetDefaultModelKeyInputSchema = Schema.Struct({
  modelKey: Schema.Union(Schema.String.pipe(Schema.nonEmptyString()), Schema.Null),
});

export type SetDefaultModelKeyInput = typeof SetDefaultModelKeyInputSchema.Type;
