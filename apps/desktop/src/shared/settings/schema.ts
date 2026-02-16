import * as S from "@effect/schema/Schema";

export const WorkspaceSettingsSchema = S.Struct({
  rootPath: S.Union(S.String.pipe(S.nonEmptyString()), S.Null),
});

export const SettingsSchemaV1 = S.Struct({
  settingsVersion: S.Literal(1),
  workspace: WorkspaceSettingsSchema,
});

export type Settings = S.Schema.Type<typeof SettingsSchemaV1>;

export const DEFAULT_SETTINGS: Settings = {
  settingsVersion: 1,
  workspace: {
    rootPath: null,
  },
};

export const SetWorkspaceRootPathInputSchema = S.Struct({
  rootPath: S.Union(S.String.pipe(S.nonEmptyString()), S.Null),
});

export type SetWorkspaceRootPathInput = S.Schema.Type<
  typeof SetWorkspaceRootPathInputSchema
>;
