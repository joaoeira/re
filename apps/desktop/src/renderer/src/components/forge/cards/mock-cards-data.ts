import type { ChunkTopics, ExtractSummary } from "../forge-page-store";
import { topicKey } from "../forge-page-store";

export type CardType = "basic" | "cloze";

export type ForgeCard = {
  readonly id: string;
  readonly type: CardType;
  readonly question: string;
  readonly answer: string;
  readonly clozeText: string | null;
};

export type ForgePermutation = {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
};

export type TopicGenerationStatus = "idle" | "generating" | "generated" | "error";

export type TopicCardGeneration = {
  readonly topicKey: string;
  readonly status: TopicGenerationStatus;
  readonly cards: ReadonlyArray<ForgeCard>;
  readonly errorMessage: string | null;
};

export const createMockCardsForTopic = (text: string, key: string): TopicCardGeneration => ({
  topicKey: key,
  status: "generated",
  cards: [
    {
      id: `${key}-0`,
      type: "basic",
      question: `What is the primary role of ${text.toLowerCase()} in biological systems?`,
      answer: `${text} plays a fundamental role in maintaining cellular homeostasis and enabling metabolic processes essential for organism survival.`,
      clozeText: null,
    },
    {
      id: `${key}-1`,
      type: "basic",
      question: `Describe the structural organization of ${text.toLowerCase()}.`,
      answer: `${text} consists of a complex arrangement of proteins, lipids, and nucleic acids organized into functional domains that coordinate cellular activity.`,
      clozeText: null,
    },
    {
      id: `${key}-2`,
      type: "basic",
      question: `How does ${text.toLowerCase()} interact with its surrounding environment?`,
      answer: `Through signal transduction pathways and membrane-bound receptors that detect chemical gradients and mechanical forces in the extracellular matrix.`,
      clozeText: null,
    },
    {
      id: `${key}-3`,
      type: "cloze",
      question: `The primary function of ${text.toLowerCase()} is energy conversion and molecular transport.`,
      answer: `The primary function of ${text.toLowerCase()} is energy conversion and molecular transport.`,
      clozeText: `The primary function of {{c1::${text.toLowerCase()}}} is {{c2::energy conversion}} and {{c3::molecular transport}}.`,
    },
    {
      id: `${key}-4`,
      type: "basic",
      question: `What happens when ${text.toLowerCase()} is disrupted or absent?`,
      answer: `Disruption leads to loss of cellular compartmentalization, impaired signaling cascades, and eventual apoptosis or necrotic cell death depending on the severity.`,
      clozeText: null,
    },
  ],
  errorMessage: null,
});

export const MOCK_PERMUTATIONS: ReadonlyArray<ForgePermutation> = [
  {
    id: "perm-0",
    question: "In what way does this structure contribute to cellular energy production?",
    answer:
      "It serves as the primary site for oxidative phosphorylation, converting ADP to ATP through the electron transport chain.",
  },
  {
    id: "perm-1",
    question: "Compare and contrast this component with its prokaryotic equivalent.",
    answer:
      "Unlike the prokaryotic version, the eukaryotic form is membrane-bound and contains its own circular DNA, supporting the endosymbiotic theory.",
  },
  {
    id: "perm-2",
    question: "What experimental evidence supports the current model of this structure?",
    answer:
      "Electron microscopy revealed the double-membrane architecture, while biochemical assays confirmed the localization of respiratory enzymes.",
  },
];

export const MOCK_CLOZE_TEXT =
  "The {{c1::inner membrane}} of the mitochondria contains {{c2::cristae}} that increase the surface area for {{c3::ATP synthesis}}.";

// Dev-skip mock data

const DEV_TOPICS: ReadonlyArray<ChunkTopics> = [
  {
    chunkId: 1,
    sequenceOrder: 1,
    topics: [
      "Cellular respiration and ATP synthesis",
      "Mitochondrial membrane structure",
      "Electron transport chain components",
    ],
  },
  {
    chunkId: 2,
    sequenceOrder: 2,
    topics: ["Krebs cycle intermediates", "Oxidative phosphorylation mechanisms"],
  },
  {
    chunkId: 3,
    sequenceOrder: 3,
    topics: ["Glycolysis pathway regulation"],
  },
];

const DEV_SELECTED_KEYS = new Set<string>([
  topicKey(1, 0),
  topicKey(1, 1),
  topicKey(1, 2),
  topicKey(2, 0),
  topicKey(2, 1),
  topicKey(3, 0),
]);

const DEV_EXTRACT_SUMMARY: ExtractSummary = {
  sessionId: 999,
  textLength: 12400,
  preview: "Chapter 3: Cellular Energetics and Metabolism...",
  totalPages: 14,
  chunkCount: 3,
};

export const DEV_SKIP_TO_CARDS = {
  topicsByChunk: DEV_TOPICS,
  selectedTopicKeys: DEV_SELECTED_KEYS,
  extractSummary: DEV_EXTRACT_SUMMARY,
} as const;
