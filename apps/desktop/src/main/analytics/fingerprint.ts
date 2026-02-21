import type { ItemMetadata } from "@re/core";

import { toIsoOrNull } from "@main/utils/format";

export const toMetadataFingerprint = (metadata: ItemMetadata): string =>
  JSON.stringify({
    id: metadata.id,
    stabilityRaw: metadata.stability.raw,
    difficultyRaw: metadata.difficulty.raw,
    state: metadata.state,
    learningSteps: metadata.learningSteps,
    lastReview: toIsoOrNull(metadata.lastReview),
    due: toIsoOrNull(metadata.due),
  });
