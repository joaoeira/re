import { Cause, Effect, Exit, Option } from "effect";
import type { RpcDefectError } from "electron-effect-rpc/renderer";

export const toRpcDefectError = (error: RpcDefectError): Error =>
  new Error(`RPC defect (${error.code}): ${error.message}`);

const toUnknownError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const runIpcEffect = async <A>(effect: Effect.Effect<A, Error>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  const typedFailure = Cause.failureOption(exit.cause);
  if (Option.isSome(typedFailure)) {
    throw typedFailure.value;
  }

  const defect = Cause.dieOption(exit.cause);
  if (Option.isSome(defect)) {
    throw toUnknownError(defect.value);
  }

  throw new Error(Cause.pretty(exit.cause));
};
