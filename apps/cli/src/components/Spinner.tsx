import { useState, useEffect } from "react";
import { themeColors as theme, glyphs } from "../ThemeContext";

interface SpinnerProps {
  label?: string;
  style?: "dots" | "pulse" | "wave";
}

export function Spinner({ label, style = "dots" }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => f + 1);
    }, 120);
    return () => clearInterval(interval);
  }, []);

  const spinner = getSpinnerFrame(style, frame);

  return (
    <box flexDirection="row" gap={2}>
      <text fg={theme.primary}>{spinner}</text>
      {label && <text fg={theme.textMuted}>{label}</text>}
    </box>
  );
}

function getSpinnerFrame(style: "dots" | "pulse" | "wave", frame: number): string {
  switch (style) {
    case "dots": {
      const patterns = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      return patterns[frame % patterns.length] ?? "⠋";
    }
    case "pulse": {
      const patterns = ["◇", "◆", "◇", "◆"];
      return patterns[frame % patterns.length] ?? "◆";
    }
    case "wave": {
      const width = 5;
      const pos = frame % (width * 2 - 2);
      const actualPos = pos < width ? pos : width * 2 - 2 - pos;
      return Array(width)
        .fill(glyphs.dotHollow)
        .map((c, i) => (i === actualPos ? glyphs.dot : c))
        .join("");
    }
  }
}

interface LoadingProps {
  message: string;
  hint?: string;
}

export function Loading({ message, hint }: LoadingProps) {
  return (
    <box
      flexDirection="column"
      gap={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <Spinner label={message} style="dots" />
      {hint && (
        <text fg={theme.textSubtle} marginLeft={3}>
          {hint}
        </text>
      )}
    </box>
  );
}
