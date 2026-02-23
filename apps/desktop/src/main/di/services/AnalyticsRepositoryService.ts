import { Context, Layer } from "effect";

import type { ReviewAnalyticsRepository } from "@main/analytics";

export const AnalyticsRepositoryService = Context.GenericTag<ReviewAnalyticsRepository>(
  "@re/desktop/main/AnalyticsRepositoryService",
);

export const AnalyticsRepositoryServiceLive = (analyticsRepository: ReviewAnalyticsRepository) =>
  Layer.succeed(AnalyticsRepositoryService, analyticsRepository);
