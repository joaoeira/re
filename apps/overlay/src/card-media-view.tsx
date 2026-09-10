import { useEffect, useState } from "react";
import { loadImage, mediaScale, renderFormula, type Media } from "./card-media";
import { toErrorMessage } from "./error-message";
import { onSettled } from "./on-settled";
import { colors, type } from "./theme";

export function MediaView({
  source,
  deckPath,
  formula,
  display = false,
}: {
  source: string;
  deckPath: string;
  formula?: boolean;
  display?: boolean;
}) {
  const [result, setResult] = useState<Media | string | null>(null);
  useEffect(() => {
    setResult(null);
    const operation = formula ? renderFormula(source, display) : loadImage(source, deckPath);
    return onSettled(
      operation.then((media) => media, toErrorMessage),
      setResult,
    );
  }, [source, deckPath, formula, display]);
  if (typeof result === "string")
    return (
      <text style={{ color: colors.error, ...type.body }}>
        {formula ? `LaTeX: ${source}` : `Image unavailable: ${source}`} — {result}
      </text>
    );
  if (!result)
    return (
      <text style={{ color: colors.muted, ...type.body }}>{formula ? "…" : "Loading image…"}</text>
    );
  const scale = mediaScale(result, formula ? 200 : 250);
  return (
    <img
      src={result.path}
      objectFit="contain"
      style={{
        width: result.width * scale,
        height: result.height * scale,
        maxWidth: "100%",
        flexShrink: 0,
        marginTop: 3,
        marginBottom: 3,
      }}
    />
  );
}
