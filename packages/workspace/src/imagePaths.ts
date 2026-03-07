import { Path } from "@effect/platform";
import { Effect, Schema } from "effect";

export const ResolveDeckImagePathReasonSchema = Schema.Literal(
  "empty_path",
  "absolute_root_path_required",
  "absolute_deck_path_required",
  "absolute_path_not_allowed",
  "scheme_not_allowed",
  "query_not_allowed",
  "fragment_not_allowed",
  "deck_outside_root",
  "path_outside_root",
);

export type ResolveDeckImagePathReason = typeof ResolveDeckImagePathReasonSchema.Type;

export class InvalidDeckImagePath extends Schema.TaggedError<InvalidDeckImagePath>(
  "@re/workspace/InvalidDeckImagePath",
)("InvalidDeckImagePath", {
  rootPath: Schema.String,
  deckPath: Schema.String,
  imagePath: Schema.String,
  reason: ResolveDeckImagePathReasonSchema,
}) {}

export const ResolvedDeckImagePathSchema = Schema.Struct({
  absolutePath: Schema.String,
  workspaceRelativePath: Schema.String,
});

export type ResolvedDeckImagePath = typeof ResolvedDeckImagePathSchema.Type;

const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

// Lexical containment only. This does not resolve symlinks; callers that need
// symlink-safe containment should do a FileSystem.realPath-based check.
const isWithinRootWithPathService = (
  pathService: Path.Path,
  rootPath: string,
  targetPath: string,
): boolean => {
  const resolvedRootPath = pathService.resolve(rootPath);
  const resolvedTargetPath = pathService.resolve(targetPath);
  const relativePath = pathService.relative(resolvedRootPath, resolvedTargetPath);

  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${pathService.sep}`) &&
      !pathService.isAbsolute(relativePath))
  );
};

export const isPathWithinRoot = (
  rootPath: string,
  targetPath: string,
): Effect.Effect<boolean, never, Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return isWithinRootWithPathService(pathService, rootPath, targetPath);
  });

export const resolveDeckImagePath = (options: {
  readonly rootPath: string;
  readonly deckPath: string;
  readonly imagePath: string;
}): Effect.Effect<ResolvedDeckImagePath, InvalidDeckImagePath, Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const normalizedImagePath = options.imagePath.trim();

    const invalid = (
      reason: ResolveDeckImagePathReason,
    ): Effect.Effect<never, InvalidDeckImagePath> =>
      Effect.fail(
        new InvalidDeckImagePath({
          rootPath: options.rootPath,
          deckPath: options.deckPath,
          imagePath: options.imagePath,
          reason,
        }),
      );

    if (normalizedImagePath.length === 0) {
      return yield* invalid("empty_path");
    }

    if (!pathService.isAbsolute(options.rootPath)) {
      return yield* invalid("absolute_root_path_required");
    }

    if (!pathService.isAbsolute(options.deckPath)) {
      return yield* invalid("absolute_deck_path_required");
    }

    if (URI_SCHEME_PATTERN.test(normalizedImagePath)) {
      return yield* invalid("scheme_not_allowed");
    }

    if (normalizedImagePath.includes("?")) {
      return yield* invalid("query_not_allowed");
    }

    if (normalizedImagePath.includes("#")) {
      return yield* invalid("fragment_not_allowed");
    }

    if (pathService.isAbsolute(normalizedImagePath)) {
      return yield* invalid("absolute_path_not_allowed");
    }

    const resolvedRootPath = pathService.resolve(options.rootPath);
    const resolvedDeckPath = pathService.resolve(options.deckPath);

    if (!isWithinRootWithPathService(pathService, resolvedRootPath, resolvedDeckPath)) {
      return yield* invalid("deck_outside_root");
    }

    const absolutePath = pathService.normalize(
      pathService.resolve(pathService.dirname(resolvedDeckPath), normalizedImagePath),
    );

    if (!isWithinRootWithPathService(pathService, resolvedRootPath, absolutePath)) {
      return yield* invalid("path_outside_root");
    }

    return {
      absolutePath,
      workspaceRelativePath: pathService.relative(resolvedRootPath, absolutePath),
    };
  });
