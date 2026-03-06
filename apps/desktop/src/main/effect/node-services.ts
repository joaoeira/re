import * as NodeCommandExecutor from "@effect/platform-node-shared/NodeCommandExecutor";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { Layer } from "effect";

const NodeFileSystemLive = NodeFileSystem.layer;
const NodeCommandExecutorLive = NodeCommandExecutor.layer.pipe(Layer.provide(NodeFileSystemLive));

export const NodeServicesLive = Layer.mergeAll(
  NodeFileSystemLive,
  NodePath.layer,
  NodeCommandExecutorLive,
);
