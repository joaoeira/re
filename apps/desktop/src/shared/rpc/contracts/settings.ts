import { Schema } from "@effect/schema";
import { rpc } from "electron-effect-rpc/contract";

import { AiModelDefinitionSchema } from "@shared/ai-models";
import {
  SetDefaultModelKeyInputSchema,
  SetPromptModelOverrideInputSchema,
  SettingsErrorSchema,
  SettingsSchemaV2,
  SetWorkspaceRootPathInputSchema,
} from "@shared/settings";

export const GetSettings = rpc(
  "GetSettings",
  Schema.Struct({}),
  SettingsSchemaV2,
  SettingsErrorSchema,
);

export const SetWorkspaceRootPath = rpc(
  "SetWorkspaceRootPath",
  SetWorkspaceRootPathInputSchema,
  SettingsSchemaV2,
  SettingsErrorSchema,
);

export const SelectDirectory = rpc(
  "SelectDirectory",
  Schema.Struct({}),
  Schema.Struct({
    path: Schema.Union(Schema.String, Schema.Null),
  }),
);

export const ListAiModels = rpc(
  "ListAiModels",
  Schema.Struct({}),
  Schema.Struct({
    models: Schema.Array(AiModelDefinitionSchema),
    applicationDefaultModelKey: Schema.String,
  }),
);

export const SetDefaultModelKey = rpc(
  "SetDefaultModelKey",
  SetDefaultModelKeyInputSchema,
  SettingsSchemaV2,
  SettingsErrorSchema,
);

export const ListPromptTasks = rpc(
  "ListPromptTasks",
  Schema.Struct({}),
  Schema.Struct({
    tasks: Schema.Array(
      Schema.Struct({
        promptId: Schema.String,
        displayName: Schema.String,
      }),
    ),
  }),
);

export const SetPromptModelOverride = rpc(
  "SetPromptModelOverride",
  SetPromptModelOverrideInputSchema,
  SettingsSchemaV2,
  SettingsErrorSchema,
);
