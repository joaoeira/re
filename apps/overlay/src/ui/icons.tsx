import { colors } from "../theme";

const svg = (width: number, height: number, viewBox: string, body: string) =>
  `<svg width="${width}" height="${height}" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

const icons = {
  back: svg(
    20,
    20,
    "0 0 20 24",
    `<path d="M14 4 L6 12 L14 20" fill="none" stroke="${colors.muted}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  undo: svg(
    20,
    20,
    "0 0 20 20",
    `<path d="M4 8h7a5 5 0 0 1 0 10M4 8l4-4M4 8l4 4" fill="none" stroke="${colors.muted}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  actions: svg(
    20,
    20,
    "0 0 20 20",
    `<circle cx="4" cy="10" r="1.4" fill="${colors.muted}"/><circle cx="10" cy="10" r="1.4" fill="${colors.muted}"/><circle cx="16" cy="10" r="1.4" fill="${colors.muted}"/>`,
  ),
  chevron: svg(
    10,
    12,
    "0 0 10 12",
    `<path d="M2 4l3 3 3-3" fill="none" stroke="${colors.muted}"/>`,
  ),
} as const;

const sizes = { back: [20, 20], undo: [20, 20], actions: [20, 20], chevron: [10, 12] } as const;

export type IconName = keyof typeof icons;

export function Icon({ name }: { readonly name: IconName }) {
  const [width, height] = sizes[name];
  return <svg source={icons[name]} style={{ width, height, flexShrink: 0 }} />;
}
