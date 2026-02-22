import { Context, Layer } from "effect";

import type { SettingsRepository } from "@main/settings/repository";

export const SettingsRepositoryService = Context.GenericTag<SettingsRepository>(
  "@re/desktop/main/SettingsRepositoryService",
);

export const SettingsRepositoryServiceLive = (settingsRepository: SettingsRepository) =>
  Layer.succeed(SettingsRepositoryService, settingsRepository);
