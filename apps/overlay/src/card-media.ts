import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { imageSize } from "image-size";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import { colors } from "./theme";

export interface Media {
  readonly path: string;
  readonly width: number;
  readonly height: number;
}
const cacheDirectory = join(tmpdir(), "re-pocket-media");
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const math = mathjax.document("", {
  InputJax: new TeX({ packages: ["base", "ams", "newcommand"], maxBuffer: 20000 }),
  OutputJax: new SVG({ fontCache: "none" }),
});
const cache = new Map<string, Promise<Media>>();
function cached(key: string, load: () => Promise<Media>): Promise<Media> {
  const previous = cache.get(key);
  if (previous) return previous;
  const operation = load();
  cache.set(key, operation);
  void operation.catch(() => cache.delete(key));
  if (cache.size > 128) cache.delete(cache.keys().next().value!);
  return operation;
}
async function store(bytes: Uint8Array, extension: string): Promise<string> {
  await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
  const hash = createHash("sha256").update(bytes).digest("hex");
  const path = join(cacheDirectory, `${hash}.${extension}`);
  await writeFile(path, bytes, { mode: 0o600 });
  return path;
}

export function loadImage(url: string, deckPath: string): Promise<Media> {
  return cached(`image:${deckPath}:${url}`, async () => {
    let path: string;
    let bytes: Uint8Array;
    if (/^(https?:|data:image\/)/i.test(url)) {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Image request failed (${response.status})`);
      bytes = new Uint8Array(await response.arrayBuffer());
      const size = imageSize(bytes);
      path = await store(bytes, size.type ?? "png");
    } else {
      if (/^[a-z][a-z\d+.-]*:/i.test(url) && !url.startsWith("file:"))
        throw new Error("Unsupported image URL");
      path = url.startsWith("file:")
        ? fileURLToPath(url)
        : resolve(dirname(deckPath), decodeURIComponent(url));
      bytes = await readFile(path);
    }
    const { width, height } = imageSize(bytes);
    return { path, width, height };
  });
}

export function renderFormula(tex: string, display: boolean): Promise<Media> {
  return cached(`math:${display}:${tex}`, async () => {
    // Reset macro/label state for each expression; one card must not affect another.
    math.inputJax[0]!.reset();
    const node = math.convert(tex, { display, em: 18, ex: 9, containerWidth: 640 });
    const svg = adaptor.tags(node, "svg")[0];
    if (
      !svg ||
      adaptor.tags(node, "merror").length ||
      adaptor.outerHTML(node).includes('data-mml-node="merror"')
    )
      throw new Error("Invalid LaTeX expression");
    const viewBox = adaptor.getAttribute(svg, "viewBox")!.split(/\s+/).map(Number);
    const width = (viewBox[2]! * 18) / 1000;
    const height = (viewBox[3]! * 18) / 1000;
    adaptor.setAttribute(svg, "width", `${width}px`);
    adaptor.setAttribute(svg, "height", `${height}px`);
    const source = adaptor.outerHTML(svg).replaceAll("currentColor", colors.text);
    const path = await store(new TextEncoder().encode(source), "svg");
    return { path, width, height };
  });
}
