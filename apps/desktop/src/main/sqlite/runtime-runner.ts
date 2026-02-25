import { Effect, Either } from "effect";

export interface RuntimeRunner<R> {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;
}

const flattenEither = <A, E>(either: Either.Either<A, E>): Effect.Effect<A, E> =>
  Either.isRight(either) ? Effect.succeed(either.right) : Effect.fail(either.left);

export const runSqlInRuntime = <R, A, E>({
  runtime,
  effect,
}: {
  readonly runtime: RuntimeRunner<R>;
  readonly effect: Effect.Effect<A, E, R>;
}): Effect.Effect<A, unknown> =>
  Effect.tryPromise(() => runtime.runPromise(Effect.either(effect))).pipe(
    Effect.flatMap(flattenEither),
  );

export const runSqlInRuntimeOrMapRuntimeError = <R, A, E, E2>({
  runtime,
  effect,
  mapRuntimeError,
}: {
  readonly runtime: RuntimeRunner<R>;
  readonly effect: Effect.Effect<A, E, R>;
  readonly mapRuntimeError: (error: unknown) => E2;
}): Effect.Effect<A, E | E2> =>
  Effect.tryPromise({
    try: () => runtime.runPromise(Effect.either(effect)),
    catch: mapRuntimeError,
  }).pipe(Effect.flatMap(flattenEither));
