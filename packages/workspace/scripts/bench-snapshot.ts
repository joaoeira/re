/**
 * Disk benchmark for snapshotWorkspace: walk a real folder tree, read and parse
 * every deck, and count cards. Complements the in-memory parse/serialize benches
 * in packages/core.
 *
 * Usage (from packages/workspace):
 *   bun scripts/bench-snapshot.ts                  # all presets
 *   bun scripts/bench-snapshot.ts small            # ~50 decks / ~1k cards
 *   bun scripts/bench-snapshot.ts medium           # ~200 decks / ~10k cards
 *   bun scripts/bench-snapshot.ts large-files      # ~1k decks / ~50k cards
 *   bun scripts/bench-snapshot.ts large-cards      # ~200 decks / ~100k cards
 *   bun scripts/bench-snapshot.ts --vault <path>   # one-off run against a real vault
 *   bun scripts/bench-snapshot.ts --runs 5 --keep  # more passes, keep generated vault
 *
 * Every pass is validated before its timing is accepted: preset runs must match
 * the generated deck/card counts with zero errors; --vault runs must stay
 * consistent from pass to pass.
 *
 * Preset runs warm up with untimed passes until timings converge (two
 * consecutive passes within 2% of the fastest pass so far, capped at 10);
 * --warmup <n> forces a fixed count instead. Freshly
 * generated files sit in the OS page cache anyway, so the measured runs
 * represent warm steady state. --vault runs default to no warm-up so run 1
 * stays as cold as the cache allows. For genuinely cold numbers, generate with
 * --keep and rerun later (e.g. after a reboot) with --vault <kept path>.
 */

import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import { performance } from "node:perf_hooks";

import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { Effect, Layer } from "effect";

import { toScanDecksErrorMessage } from "../src/scanDecks";
import { snapshotWorkspace, type SnapshotWorkspaceResult } from "../src/snapshotWorkspace";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

interface Preset {
  readonly seed: number;
  readonly summary: string;
  readonly smallDecks: number;
  readonly smallCardRange: readonly [number, number];
  readonly largeDecks: number;
  readonly largeCardRange: readonly [number, number];
  readonly folderCount: number;
}

const PRESETS: Record<string, Preset> = {
  small: {
    seed: 0xc0ffee,
    summary: "~50 decks / ~1k cards",
    smallDecks: 48,
    smallCardRange: [5, 25],
    largeDecks: 2,
    largeCardRange: [200, 300],
    folderCount: 12,
  },
  medium: {
    seed: 0xbeefed,
    summary: "~200 decks / ~10k cards",
    smallDecks: 190,
    smallCardRange: [5, 50],
    largeDecks: 10,
    largeCardRange: [200, 1000],
    folderCount: 12,
  },
  "large-files": {
    seed: 0xf11e5,
    summary: "~1,000 decks / ~50k cards / ~200 content folders",
    smallDecks: 950,
    smallCardRange: [20, 60],
    largeDecks: 50,
    largeCardRange: [120, 360],
    folderCount: 200,
  },
  "large-cards": {
    seed: 0xca4d5,
    summary: "~200 decks / ~100k cards",
    smallDecks: 190,
    smallCardRange: [100, 300],
    largeDecks: 10,
    largeCardRange: [4000, 8000],
    folderCount: 12,
  },
};

const FOLDERS = [
  "",
  "inbox",
  "math",
  "math/algebra",
  "math/analysis/real",
  "science",
  "science/physics",
  "science/physics/quantum",
  "science/biology",
  "languages/spanish",
  "languages/japanese/kanji",
  "history/europe",
] as const;

const buildFolderPool = (folderCount: number): readonly string[] => {
  if (folderCount <= FOLDERS.length) {
    return FOLDERS.slice(0, folderCount);
  }

  const folders: string[] = [...FOLDERS];
  for (let index = FOLDERS.length; index < folderCount; index++) {
    const region = String(Math.floor(index / 50)).padStart(2, "0");
    const collection = String(Math.floor(index / 10)).padStart(3, "0");
    const topic = String(index).padStart(3, "0");
    folders.push(`collections/region-${region}/collection-${collection}/topic-${topic}`);
  }
  return folders;
};

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Rng = () => number;

const randInt = (rng: Rng, low: number, high: number): number =>
  low + Math.floor(rng() * (high - low + 1));

const pick = <T>(rng: Rng, values: readonly T[]): T => values[randInt(rng, 0, values.length - 1)]!;

const isoOffset = (base: Date, offsetMs: number): string =>
  new Date(base.getTime() + offsetMs).toISOString();

const metadataLine = (rng: Rng, id: string, now: Date): string => {
  const roll = rng();

  if (roll < 0.35) {
    return `<!--@ ${id} 0 0 0 0-->`;
  }

  if (roll < 0.8) {
    const stability = 1 + rng() * 120;
    const difficulty = 1 + rng() * 9;
    const lastReview = isoOffset(now, -randInt(rng, 1, 90) * DAY_MS);
    const due = isoOffset(now, (rng() * 90 - 45) * DAY_MS);
    return `<!--@ ${id} ${stability} ${difficulty} 2 0 ${lastReview} ${due}-->`;
  }

  if (roll < 0.92) {
    const lastReviewOffset = -randInt(rng, 0, 120) * MINUTE_MS;
    const lastReview = isoOffset(now, lastReviewOffset);
    const due = isoOffset(now, lastReviewOffset + 10 * MINUTE_MS);
    return `<!--@ ${id} ${0.2 + rng()} ${4 + rng() * 4} 1 ${randInt(rng, 0, 1)} ${lastReview} ${due}-->`;
  }

  const lastReviewOffset = -randInt(rng, 0, 24 * 60) * MINUTE_MS;
  const lastReview = isoOffset(now, lastReviewOffset);
  const due = isoOffset(now, lastReviewOffset + 10 * MINUTE_MS);
  return `<!--@ ${id} ${1 + rng() * 3} ${5 + rng() * 4} 3 0 ${lastReview} ${due}-->`;
};

const itemBody = (rng: Rng, deckIndex: number, itemIndex: number): string => {
  const lines = [
    `Question ${itemIndex}: what is the key idea behind concept ${itemIndex} of deck ${deckIndex}?`,
    "---",
    `It combines ${pick(rng, ["retrieval practice", "spacing", "interleaving", "elaboration"])} with idea ${itemIndex}, plus enough surrounding prose to make parsing realistic.`,
  ];
  if (rng() < 0.15) {
    lines.push(`![diagram](assets/img-${randInt(rng, 0, 9)}.png)`);
  }
  return `${lines.join("\n")}\n\n`;
};

const deckContent = (
  rng: Rng,
  deckIndex: number,
  cardTarget: number,
  now: Date,
): { content: string; cards: number } => {
  let content = rng() < 0.5 ? `---\ntitle: Deck ${deckIndex}\n---\n\n` : `# Deck ${deckIndex}\n\n`;
  let cards = 0;
  let itemIndex = 0;

  while (cards < cardTarget) {
    const remaining = cardTarget - cards;
    const cardsInItem = rng() < 0.1 ? Math.min(randInt(rng, 2, 3), remaining) : 1;
    for (let k = 0; k < cardsInItem; k++) {
      content += `${metadataLine(rng, `bench-d${deckIndex}-i${itemIndex}-c${k}`, now)}\n`;
      cards += 1;
    }
    content += itemBody(rng, deckIndex, itemIndex);
    itemIndex += 1;
  }

  return { content, cards };
};

const writeVaultFile = async (root: string, relativePath: string, data: string | Uint8Array) => {
  const absolutePath = nodePath.join(root, relativePath);
  await mkdir(nodePath.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, data);
};

const fakeBinary = (size: number, seedByte: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = (i * 31 + seedByte) & 0xff;
  }
  return bytes;
};

const generateVault = async (
  root: string,
  preset: Preset,
  now: Date,
): Promise<{ decks: number; cards: number }> => {
  const rng = mulberry32(preset.seed);
  const folders = buildFolderPool(preset.folderCount);
  let decks = 0;
  let cards = 0;

  const writeDeck = async (cardRange: readonly [number, number]) => {
    const deckIndex = decks;
    const folder = pick(rng, folders);
    const relativePath = nodePath.join(folder, `deck-${String(deckIndex).padStart(3, "0")}.md`);
    const deck = deckContent(rng, deckIndex, randInt(rng, cardRange[0], cardRange[1]), now);
    await writeVaultFile(root, relativePath, deck.content);
    decks += 1;
    cards += deck.cards;

    if (deckIndex % 10 === 0) {
      await writeVaultFile(
        root,
        nodePath.join(folder, `scratch-${deckIndex}.draft.md`),
        `<!--@ draft-${deckIndex} 0 0 0 0-->\nIgnored draft ${deckIndex}\n---\nShould never be scanned.\n`,
      );
    }
  };

  for (let i = 0; i < preset.smallDecks; i++) {
    await writeDeck(preset.smallCardRange);
  }
  for (let i = 0; i < preset.largeDecks; i++) {
    await writeDeck(preset.largeCardRange);
  }

  await writeVaultFile(
    root,
    ".reignore",
    "# excluded from scanning\ntemplates/\narchive/\n*.draft.md\n",
  );
  await writeVaultFile(
    root,
    "templates/daily.md",
    "<!--@ template-1 0 0 0 0-->\nTemplate question\n---\nTemplate answer\n",
  );
  await writeVaultFile(root, "templates/review.md", "# Review template\n");
  await writeVaultFile(
    root,
    "archive/old-deck.md",
    "<!--@ archived-1 0 0 0 0-->\nArchived question\n---\nArchived answer\n",
  );
  await writeVaultFile(root, "vault-meta.json", JSON.stringify({ generated: now.toISOString() }));
  await writeVaultFile(root, "README.txt", "Synthetic benchmark vault. Safe to delete.\n");

  await writeVaultFile(root, ".git/HEAD", "ref: refs/heads/master\n");
  await writeVaultFile(root, ".git/config", "[core]\n\trepositoryformatversion = 0\n");
  for (let i = 0; i < 5; i++) {
    await writeVaultFile(root, `.git/objects/ab/${i}f3c9d1e`, fakeBinary(2048, i));
  }

  for (const folder of folders) {
    if (folder === "" || rng() < 0.4) {
      continue;
    }
    await writeVaultFile(root, nodePath.join(folder, "notes.txt"), `Notes for ${folder}\n`);
    const imageCount = randInt(rng, 1, 3);
    for (let i = 0; i < imageCount; i++) {
      await writeVaultFile(
        root,
        nodePath.join(folder, "assets", `img-${i}.png`),
        fakeBinary(randInt(rng, 4, 64) * 1024, i),
      );
    }
  }

  return { decks, cards };
};

const sweepVault = async (
  root: string,
): Promise<{ files: number; directories: number; bytes: number }> => {
  let files = 0;
  let directories = 0;
  let bytes = 0;
  const stack = [root];

  while (stack.length > 0) {
    const directory = stack.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = nodePath.join(directory, entry.name);
      if (entry.isDirectory()) {
        directories += 1;
        stack.push(entryPath);
      } else if (entry.isFile()) {
        files += 1;
        bytes += (await stat(entryPath)).size;
      }
    }
  }

  return { files, directories, bytes };
};

const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const timedSnapshot = async (
  root: string,
  asOf: Date,
): Promise<{ ms: number; result: SnapshotWorkspaceResult }> => {
  const start = performance.now();
  const result = await Effect.runPromise(
    snapshotWorkspace(root, { asOf }).pipe(
      Effect.mapError((error) => new Error(toScanDecksErrorMessage(error))),
      Effect.provide(PlatformLive),
    ),
  );
  return { ms: performance.now() - start, result };
};

const summarize = (result: SnapshotWorkspaceResult) => {
  const summary = {
    okDecks: 0,
    errorDecks: 0,
    cards: 0,
    due: 0,
    states: { new: 0, learning: 0, review: 0, relearning: 0 },
  };

  for (const deck of result.decks) {
    if (deck.status !== "ok") {
      summary.errorDecks += 1;
      continue;
    }
    summary.okDecks += 1;
    summary.cards += deck.totalCards;
    summary.due += deck.dueCards;
    summary.states.new += deck.stateCounts.new;
    summary.states.learning += deck.stateCounts.learning;
    summary.states.review += deck.stateCounts.review;
    summary.states.relearning += deck.stateCounts.relearning;
  }

  return summary;
};

const formatInt = (value: number): string => value.toLocaleString("en-US");

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;

const formatMs = (ms: number): string => `${ms.toFixed(1)} ms`.padStart(11);

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
};

interface ExpectedCounts {
  readonly decks: number;
  readonly cards: number;
}

const MIN_ADAPTIVE_WARMUP = 3;
const MAX_ADAPTIVE_WARMUP = 10;
const WARMUP_STABLE_PASSES = 2;
const WARMUP_CONVERGENCE_TOLERANCE = 0.02;

const runBench = async (
  root: string,
  runs: number,
  warmup: number | "auto",
  asOf: Date,
  expected?: ExpectedCounts,
) => {
  let reference = expected;

  const checkRun = (result: SnapshotWorkspaceResult, passLabel: string) => {
    const summary = summarize(result);
    const problems: string[] = [];

    if (reference === undefined) {
      reference = { decks: result.decks.length, cards: summary.cards };
    } else {
      if (result.decks.length !== reference.decks) {
        problems.push(`expected ${reference.decks} decks, found ${result.decks.length}`);
      }
      if (summary.cards !== reference.cards) {
        problems.push(
          `expected ${formatInt(reference.cards)} cards, counted ${formatInt(summary.cards)}`,
        );
      }
    }
    if (expected !== undefined && summary.errorDecks > 0) {
      problems.push(`${summary.errorDecks} decks failed to read/parse`);
    }
    if (problems.length > 0) {
      throw new Error(`${passLabel} produced a wrong snapshot: ${problems.join("; ")}`);
    }
    return summary;
  };

  const warmupTimes: number[] = [];
  const warmupCap = warmup === "auto" ? MAX_ADAPTIVE_WARMUP : warmup;
  let bestWarmup = Infinity;
  let stablePasses = 0;

  while (warmupTimes.length < warmupCap) {
    const { ms, result } = await timedSnapshot(root, asOf);
    checkRun(result, `warm-up pass ${warmupTimes.length + 1}`);
    warmupTimes.push(ms);
    if (warmup === "auto" && warmupTimes.length >= MIN_ADAPTIVE_WARMUP) {
      const withinBand =
        ms >= bestWarmup * (1 - WARMUP_CONVERGENCE_TOLERANCE) &&
        ms <= bestWarmup * (1 + WARMUP_CONVERGENCE_TOLERANCE);
      stablePasses = withinBand ? stablePasses + 1 : 0;
      if (stablePasses >= WARMUP_STABLE_PASSES) break;
    }
    bestWarmup = Math.min(bestWarmup, ms);
  }

  const times: number[] = [];
  let firstSummary: ReturnType<typeof summarize> | undefined;
  let firstDeckCount = 0;

  for (let i = 0; i < runs; i++) {
    const { ms, result } = await timedSnapshot(root, asOf);
    const summary = checkRun(result, `run ${i + 1}`);
    times.push(ms);
    if (firstSummary === undefined) {
      firstSummary = summary;
      firstDeckCount = result.decks.length;
    }
  }

  const summary = firstSummary!;
  console.log(
    `snapshot: ${formatInt(firstDeckCount)} decks (${summary.errorDecks} errors) | ` +
      `${formatInt(summary.cards)} cards | ${formatInt(summary.due)} due | ` +
      `new ${formatInt(summary.states.new)} / learning ${formatInt(summary.states.learning)} / ` +
      `review ${formatInt(summary.states.review)} / relearning ${formatInt(summary.states.relearning)}`,
  );
  console.log();
  if (warmupTimes.length > 0) {
    console.log(
      `  warm-up: ${warmupTimes.length} untimed ${warmupTimes.length === 1 ? "pass" : "passes"} ` +
        `(${warmupTimes.map((ms) => ms.toFixed(1)).join(" → ")} ms)`,
    );
  }
  times.forEach((ms, index) => {
    console.log(`  run ${index + 1}:${formatMs(ms)}`);
  });
  console.log(
    `  median:${formatMs(median(times))}   ` +
      `(min ${Math.min(...times).toFixed(1)} / max ${Math.max(...times).toFixed(1)} ms over ${runs} runs)`,
  );
  console.log();
};

const runPreset = async (
  name: string,
  preset: Preset,
  runs: number,
  warmup: number | "auto",
  keep: boolean,
) => {
  const now = new Date();
  const root = await mkdtemp(nodePath.join(tmpdir(), `re-bench-${name}-`));

  console.log(`── preset: ${name} (${preset.summary})`);
  const generated = await generateVault(root, preset, now);
  const disk = await sweepVault(root);
  console.log(
    `vault: ${root}\n` +
      `disk: ${formatInt(disk.files)} files in ${formatInt(disk.directories)} directories, ` +
      `${formatBytes(disk.bytes)} | generated ${formatInt(generated.decks)} decks / ` +
      `${formatInt(generated.cards)} cards`,
  );

  await runBench(root, runs, warmup, now, { decks: generated.decks, cards: generated.cards });

  if (keep) {
    console.log(`kept vault at ${root} (rerun with --vault ${root})\n`);
  } else {
    await rm(root, { recursive: true, force: true });
  }
};

const runRealVault = async (vaultPath: string, runs: number, warmup: number) => {
  const root = nodePath.resolve(vaultPath);
  console.log(`── real vault: ${root}`);
  await runBench(root, runs, warmup, new Date());

  const disk = await sweepVault(root);
  console.log(
    `disk: ${formatInt(disk.files)} files in ${formatInt(disk.directories)} directories, ` +
      `${formatBytes(disk.bytes)} (measured after the timed runs)\n`,
  );
};

const usage = (): never => {
  console.error(
    "Usage: bun scripts/bench-snapshot.ts [small] [medium] [large-files] [large-cards] [--vault <path>] [--runs <n>] [--warmup <n>] [--keep]",
  );
  process.exit(1);
};

const main = async () => {
  const args = process.argv.slice(2);
  const presetNames: string[] = [];
  let runs = 5;
  let warmup: number | undefined;
  let keep = false;
  let vaultPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--runs") {
      runs = Number(args[++i]);
      if (!Number.isInteger(runs) || runs < 1) usage();
    } else if (arg === "--warmup") {
      warmup = Number(args[++i]);
      if (!Number.isInteger(warmup) || warmup < 0) usage();
    } else if (arg === "--keep") {
      keep = true;
    } else if (arg === "--vault") {
      vaultPath = args[++i];
      if (vaultPath === undefined) usage();
    } else if (arg in PRESETS) {
      presetNames.push(arg);
    } else {
      usage();
    }
  }

  if (vaultPath !== undefined) {
    await runRealVault(vaultPath, runs, warmup ?? 0);
    return;
  }

  const selected = presetNames.length > 0 ? presetNames : Object.keys(PRESETS);
  for (const name of selected) {
    await runPreset(name, PRESETS[name]!, runs, warmup ?? "auto", keep);
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
