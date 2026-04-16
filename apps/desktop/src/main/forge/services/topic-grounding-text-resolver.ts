import { Context, Effect } from "effect";

import {
  ForgeSessionRepositoryError,
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

export const makeTopicGroundingTextResolver = (): TopicGroundingTextResolver => ({
  resolveForTopic: (topic) =>
    topic.chunkText !== null
      ? Effect.succeed(topic.chunkText)
      : Effect.fail(
          new ForgeSessionRepositoryError({
            operation: "resolveForTopic.detail",
            message: `Topic ${topic.topicId} is missing chunk grounding text.`,
          }),
        ),
});
