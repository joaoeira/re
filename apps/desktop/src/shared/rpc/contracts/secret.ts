import { Schema } from "@effect/schema";
import { rpc } from "electron-effect-rpc/contract";

import { SecretKeySchema, SecretStoreErrorSchema } from "@shared/secrets";

export const HasApiKey = rpc(
  "HasApiKey",
  Schema.Struct({
    key: SecretKeySchema,
  }),
  Schema.Struct({
    configured: Schema.Boolean,
  }),
  SecretStoreErrorSchema,
);

export const SetApiKey = rpc(
  "SetApiKey",
  Schema.Struct({
    key: SecretKeySchema,
    value: Schema.String,
  }),
  Schema.Struct({
    success: Schema.Boolean,
  }),
  SecretStoreErrorSchema,
);

export const DeleteApiKey = rpc(
  "DeleteApiKey",
  Schema.Struct({
    key: SecretKeySchema,
  }),
  Schema.Struct({
    success: Schema.Boolean,
  }),
  SecretStoreErrorSchema,
);
