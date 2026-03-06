import * as Command from "@effect/platform/Command";
import type { PlatformError } from "@effect/platform/Error";
import type { CommandExecutor } from "@effect/platform/CommandExecutor";
import { Context, Effect, Stream } from "effect";

import { GitBinaryNotAvailableError, GitCommandTransportError } from "@shared/git";
import { toErrorMessage } from "@main/utils/format";

export interface GitCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitCommandRunner {
  readonly run: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
  }) => Effect.Effect<GitCommandResult, GitBinaryNotAvailableError | GitCommandTransportError>;
}

export const GitCommandRunner = Context.GenericTag<GitCommandRunner>(
  "@re/desktop/main/GitCommandRunner",
);

const streamToString = (stream: Stream.Stream<Uint8Array, PlatformError>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold("", (acc, chunk) => acc + chunk),
  );

const toTransportError = (
  args: ReadonlyArray<string>,
  error: PlatformError,
): GitBinaryNotAvailableError | GitCommandTransportError =>
  error._tag === "SystemError" && error.reason === "NotFound"
    ? new GitBinaryNotAvailableError({
        message: "git is not installed or is not available to the desktop app process.",
      })
    : new GitCommandTransportError({
        command: ["git", ...args],
        message: toErrorMessage(error),
      });

export const makeGitCommandRunner = ({
  commandExecutor,
}: {
  readonly commandExecutor: CommandExecutor;
}): GitCommandRunner => ({
  run: ({ cwd, args }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const command = Command.make("git", ...args).pipe(
          Command.workingDirectory(cwd),
          Command.env({
            GIT_TERMINAL_PROMPT: "0",
          }),
        );

        const process = yield* commandExecutor
          .start(command)
          .pipe(Effect.mapError((error) => toTransportError(args, error)));

        const [exitCode, stdout, stderr] = yield* Effect.all(
          [
            process.exitCode.pipe(Effect.map((code) => Number(code))),
            streamToString(process.stdout),
            streamToString(process.stderr),
          ],
          { concurrency: 3 },
        ).pipe(Effect.mapError((error) => toTransportError(args, error)));

        return { exitCode, stdout, stderr };
      }),
    ),
});
