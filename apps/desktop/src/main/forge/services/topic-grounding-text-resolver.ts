import { Context, Effect, Layer } from "effect";

import {
  ForgeSessionRepositoryError,
  type ForgeSessionRepository,
  type ForgeTopicRecord,
} from "./forge-session-repository";

export interface TopicGroundingTextResolver {
  readonly resolveForTopic: (
    topic: ForgeTopicRecord,
  ) => Effect.Effect<string, ForgeSessionRepositoryError>;
}

export const TopicGroundingTextResolver = Context.GenericTag<TopicGroundingTextResolver>(
  "@re/desktop/main/TopicGroundingTextResolver",
);

export const makeTopicGroundingTextResolver = ({
  repository,
}: {
  readonly repository: ForgeSessionRepository;
}): TopicGroundingTextResolver => ({
  resolveForTopic: (topic) => {
    if (topic.family === "detail") {
      return topic.chunkText !== null
        ? Effect.succeed(topic.chunkText)
        : Effect.fail(
            new ForgeSessionRepositoryError({
              operation: "resolveForTopic.detail",
              message: `Detail topic ${topic.topicId} is missing chunk grounding text.`,
            }),
          );
    }

    return repository.getFullSessionText(topic.sessionId);
  },
});

export const TopicGroundingTextResolverLive = (repository: ForgeSessionRepository) =>
  Layer.succeed(
    TopicGroundingTextResolver,
    makeTopicGroundingTextResolver({ repository }),
  );
