import { Context, Data, Effect } from "effect";

export interface ClipboardImage {
  readonly bytes: Uint8Array;
  readonly extension: string;
}

export class ClipboardImageUnavailable extends Data.TaggedError("ClipboardImageUnavailable")<{
  readonly message: string;
}> {}

export class ClipboardImageReadError extends Data.TaggedError("ClipboardImageReadError")<{
  readonly message: string;
}> {}

export interface ClipboardImageReader {
  readonly readImage: () => Effect.Effect<
    ClipboardImage,
    ClipboardImageUnavailable | ClipboardImageReadError
  >;
}

export const ClipboardImageReader = Context.GenericTag<ClipboardImageReader>(
  "@re/raycast/ClipboardImageReader",
);
