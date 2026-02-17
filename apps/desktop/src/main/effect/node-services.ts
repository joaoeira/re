import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { Layer } from "effect";

export const NodeServicesLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
