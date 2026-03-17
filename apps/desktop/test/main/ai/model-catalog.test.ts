import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Cause, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  getBundledAiModelCatalogDocument,
  makeAiModelCatalogRepository,
} from "@main/ai/model-catalog-repository";
import { NodeServicesLive } from "@main/effect/node-services";
import {
  AiModelCatalogReadFailed,
  AiModelNotFound,
  type AiModelCatalogDocument,
} from "@shared/ai-models";
import { AiModelCatalogService, AiModelCatalogServiceLive } from "@main/di";
import { AiModelCatalogRepositoryLive } from "@main/ai/model-catalog-repository";

const bundledAiModelCatalogDocument = getBundledAiModelCatalogDocument();

const getFailure = <A, E>(exit: Exit.Exit<A, E>): E => {
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected failure exit.");
  }

  const failure = Cause.failureOption(exit.cause);

  if (failure._tag === "None") {
    throw new Error("Expected failure cause.");
  }

  return failure.value;
};

const makeRepository = (aiModelCatalogFilePath: string) =>
  makeAiModelCatalogRepository({ aiModelCatalogFilePath }).pipe(
    Effect.provide(NodeServicesLive),
    Effect.runPromise,
  );

const makeCatalogService = (aiModelCatalogFilePath: string) => {
  const repositoryLayer = AiModelCatalogRepositoryLive({ aiModelCatalogFilePath }).pipe(
    Layer.provide(NodeServicesLive),
  );
  const catalogLayer = AiModelCatalogServiceLive.pipe(Layer.provide(repositoryLayer));

  return Effect.gen(function* () {
    return yield* AiModelCatalogService;
  }).pipe(Effect.provide(catalogLayer), Effect.runPromise);
};

const writeCatalog = async (
  aiModelCatalogFilePath: string,
  payload: AiModelCatalogDocument | string,
): Promise<void> => {
  await fs.mkdir(path.dirname(aiModelCatalogFilePath), { recursive: true });
  await fs.writeFile(
    aiModelCatalogFilePath,
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
    "utf8",
  );
};

describe("AI model catalog", () => {
  it("seeds the bundled catalog on first read when the file is missing", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-ai-model-catalog-"));
    const aiModelCatalogFilePath = path.join(rootPath, "ai-models.json");

    try {
      const repository = await makeRepository(aiModelCatalogFilePath);
      const catalog = await Effect.runPromise(repository.getCatalog());
      const seededCatalog = JSON.parse(await fs.readFile(aiModelCatalogFilePath, "utf8"));

      expect(catalog).toEqual(bundledAiModelCatalogDocument);
      expect(seededCatalog).toEqual(bundledAiModelCatalogDocument);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("recovers from invalid JSON by re-seeding the bundled catalog", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-ai-model-catalog-"));
    const aiModelCatalogFilePath = path.join(rootPath, "ai-models.json");

    try {
      await writeCatalog(aiModelCatalogFilePath, "{ not valid json");
      const repository = await makeRepository(aiModelCatalogFilePath);
      const catalog = await Effect.runPromise(repository.getCatalog());
      const reseededContent = JSON.parse(await fs.readFile(aiModelCatalogFilePath, "utf8"));

      expect(catalog).toEqual(bundledAiModelCatalogDocument);
      expect(reseededContent).toEqual(bundledAiModelCatalogDocument);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("recovers from invalid schema by re-seeding the bundled catalog", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-ai-model-catalog-"));
    const aiModelCatalogFilePath = path.join(rootPath, "ai-models.json");

    try {
      await writeCatalog(aiModelCatalogFilePath, {
        catalogVersion: 1,
        applicationDefaultModelKey: "gemini/gemini-3-flash-preview",
      } as unknown as AiModelCatalogDocument);
      const repository = await makeRepository(aiModelCatalogFilePath);
      const catalog = await Effect.runPromise(repository.getCatalog());
      const reseededContent = JSON.parse(await fs.readFile(aiModelCatalogFilePath, "utf8"));

      expect(catalog).toEqual(bundledAiModelCatalogDocument);
      expect(reseededContent).toEqual(bundledAiModelCatalogDocument);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("rejects duplicate model keys at decode time", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-ai-model-catalog-"));
    const aiModelCatalogFilePath = path.join(rootPath, "ai-models.json");

    try {
      const firstModel = bundledAiModelCatalogDocument.models[0]!;
      const secondModel = bundledAiModelCatalogDocument.models[1]!;

      await writeCatalog(aiModelCatalogFilePath, {
        ...bundledAiModelCatalogDocument,
        models: [
          firstModel,
          {
            ...secondModel,
            key: firstModel.key,
          },
        ],
      });
      const repository = await makeRepository(aiModelCatalogFilePath);
      const exit = await Effect.runPromiseExit(repository.getCatalog());
      const failure = getFailure(exit);

      expect(failure).toBeInstanceOf(AiModelCatalogReadFailed);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("rejects a missing application default model key", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-ai-model-catalog-"));
    const aiModelCatalogFilePath = path.join(rootPath, "ai-models.json");

    try {
      await writeCatalog(aiModelCatalogFilePath, {
        ...bundledAiModelCatalogDocument,
        applicationDefaultModelKey: "openai/does-not-exist",
      });
      const repository = await makeRepository(aiModelCatalogFilePath);
      const exit = await Effect.runPromiseExit(repository.getCatalog());
      const failure = getFailure(exit);

      expect(failure).toBeInstanceOf(AiModelCatalogReadFailed);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });


  it("returns a model definition for an existing key", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-ai-model-catalog-"));
    const aiModelCatalogFilePath = path.join(rootPath, "ai-models.json");

    try {
      const catalog = await makeCatalogService(aiModelCatalogFilePath);
      const model = await Effect.runPromise(
        catalog.getModel("gemini/gemini-3-flash-preview"),
      );

      expect(model.displayName).toBe("Gemini 3 Flash Preview");
      expect(model.providerId).toBe("gemini");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("fails with AiModelNotFound for an unknown key", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-ai-model-catalog-"));
    const aiModelCatalogFilePath = path.join(rootPath, "ai-models.json");

    try {
      const catalog = await makeCatalogService(aiModelCatalogFilePath);
      const exit = await Effect.runPromiseExit(catalog.getModel("openai/does-not-exist"));
      const failure = getFailure(exit);

      expect(failure).toBeInstanceOf(AiModelNotFound);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
