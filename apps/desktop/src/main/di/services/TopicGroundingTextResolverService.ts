import { Effect, Layer } from "effect";

import {
  TopicGroundingTextResolver,
  makeTopicGroundingTextResolver,
  type TopicGroundingTextResolver as TopicGroundingTextResolverContract,
} from "@main/forge/services/topic-grounding-text-resolver";

import { ForgeSessionRepositoryService } from "./ForgeSessionRepositoryService";

export const TopicGroundingTextResolverService = TopicGroundingTextResolver;
export type TopicGroundingTextResolverService = TopicGroundingTextResolverContract;

export const TopicGroundingTextResolverServiceLive = Layer.effect(
  TopicGroundingTextResolverService,
  Effect.gen(function* () {
    const repository = yield* ForgeSessionRepositoryService;
    return makeTopicGroundingTextResolver({ repository });
  }),
);
