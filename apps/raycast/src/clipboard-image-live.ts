import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

import { Clipboard } from "@raycast/api";
import { Effect, Layer } from "effect";

import {
  ClipboardImageReadError,
  ClipboardImageReader,
  ClipboardImageUnavailable,
  type ClipboardImage,
} from "./clipboard-image";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const RAW_CLIPBOARD_MAX_BUFFER = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024 * 1024;
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

const READ_CLIPBOARD_IMAGE_SCRIPT = String.raw`
ObjC.import("AppKit");

const pasteboard = $.NSPasteboard.generalPasteboard;
let data = pasteboard.dataForType("public.png");

if (!data) {
  const tiff = pasteboard.dataForType("public.tiff");
  if (tiff) {
    const bitmap = $.NSBitmapImageRep.imageRepWithData(tiff);
    if (bitmap) {
      data = bitmap.representationUsingTypeProperties(4, $());
    }
  }
}

data ? ObjC.unwrap(data.base64EncodedStringWithOptions(0)) : "";
`;

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const normalizeClipboardFilePath = (filePath: string): string =>
  filePath.startsWith("file://") ? fileURLToPath(filePath) : filePath;

const readImageFile = (filePath: string): Effect.Effect<ClipboardImage, ClipboardImageReadError> =>
  Effect.gen(function* () {
    const normalizedPath = yield* Effect.try({
      try: () => normalizeClipboardFilePath(filePath),
      catch: (error) =>
        new ClipboardImageReadError({
          message: `Could not understand the copied file path: ${toErrorMessage(error)}`,
        }),
    });
    const extension = extname(normalizedPath).toLowerCase();

    if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
      return yield* new ClipboardImageReadError({
        message: "The copied file is not a supported image.",
      });
    }

    const fileStats = yield* Effect.tryPromise({
      try: () => stat(normalizedPath),
      catch: (error) =>
        new ClipboardImageReadError({
          message: `Could not inspect the copied image: ${toErrorMessage(error)}`,
        }),
    });

    if (fileStats.size > MAX_IMAGE_BYTES) {
      return yield* new ClipboardImageReadError({
        message: "The copied image is larger than 10 MiB.",
      });
    }

    const bytes = yield* Effect.tryPromise({
      try: () => readFile(normalizedPath),
      catch: (error) =>
        new ClipboardImageReadError({
          message: `Could not read the copied image: ${toErrorMessage(error)}`,
        }),
    });

    return { bytes, extension };
  });

const readRawClipboardPng = (): Effect.Effect<
  ClipboardImage,
  ClipboardImageUnavailable | ClipboardImageReadError
> =>
  Effect.gen(function* () {
    const stdout = yield* Effect.tryPromise({
      try: () =>
        new Promise<string>((resolve, reject) => {
          execFile(
            "/usr/bin/osascript",
            ["-l", "JavaScript", "-e", READ_CLIPBOARD_IMAGE_SCRIPT],
            { encoding: "utf8", maxBuffer: RAW_CLIPBOARD_MAX_BUFFER },
            (error, output) => {
              if (error) {
                reject(error);
                return;
              }
              resolve(output);
            },
          );
        }),
      catch: (error) =>
        new ClipboardImageReadError({
          message: `Could not read the copied image: ${toErrorMessage(error)}`,
        }),
    });

    const encoded = stdout.trim();
    if (encoded.length === 0) {
      return yield* new ClipboardImageUnavailable({
        message: "Copy an image before using Insert Image.",
      });
    }

    const bytes = Buffer.from(encoded, "base64");
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return yield* new ClipboardImageReadError({
        message: "The copied image is larger than 10 MiB.",
      });
    }

    return { bytes, extension: ".png" };
  });

const readImage = (): Effect.Effect<
  ClipboardImage,
  ClipboardImageUnavailable | ClipboardImageReadError
> =>
  Effect.gen(function* () {
    const clipboard = yield* Effect.tryPromise({
      try: () => Clipboard.read(),
      catch: (error) =>
        new ClipboardImageReadError({
          message: `Could not read the clipboard: ${toErrorMessage(error)}`,
        }),
    });

    return clipboard.file === undefined
      ? yield* readRawClipboardPng()
      : yield* readImageFile(clipboard.file);
  });

export const ClipboardImageReaderLive: Layer.Layer<ClipboardImageReader> = Layer.succeed(
  ClipboardImageReader,
  ClipboardImageReader.of({ readImage }),
);
