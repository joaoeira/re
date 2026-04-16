import {
  TopicGroundingTextResolver,
  makeTopicGroundingTextResolver,
  type TopicGroundingTextResolver as TopicGroundingTextResolverContract,
} from "@main/forge/services/topic-grounding-text-resolver";
import { Layer } from "effect";

export const TopicGroundingTextResolverService = TopicGroundingTextResolver;
export type TopicGroundingTextResolverService = TopicGroundingTextResolverContract;

export const TopicGroundingTextResolverServiceLive = Layer.succeed(
  TopicGroundingTextResolverService,
  makeTopicGroundingTextResolver(),
);
