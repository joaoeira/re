import { themeColors as theme, glyphs, spacing } from "../ThemeContext";
import { TextAttributes, type BorderCharacters } from "@opentui/core";
import type { ReactNode } from "react";

/**
 * Empty border characters - all spaces for invisible borders.
 */
const EmptyBorder: BorderCharacters = {
  topLeft: " ",
  topRight: " ",
  bottomLeft: " ",
  bottomRight: " ",
  horizontal: " ",
  vertical: " ",
  topT: " ",
  bottomT: " ",
  leftT: " ",
  rightT: " ",
  cross: " ",
};

/**
 * App header with decorative accent line.
 */
interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <box flexDirection="column" marginBottom={1}>
      <box flexDirection="row" gap={2} alignItems="center">
        <text fg={theme.accent}>{glyphs.diamond}</text>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {title}
        </text>
      </box>
      {subtitle && (
        <text fg={theme.textMuted} marginLeft={3}>
          {subtitle}
        </text>
      )}
    </box>
  );
}

/**
 * Panel with optional left border for visual grouping.
 */
interface PanelProps {
  children: ReactNode;
  accent?: boolean;
  padded?: boolean;
}

export function Panel({ children, accent = false, padded = true }: PanelProps) {
  return (
    <box
      flexDirection="column"
      border={accent ? ["left"] : undefined}
      customBorderChars={
        accent
          ? { ...EmptyBorder, vertical: glyphs.verticalBarHeavy }
          : undefined
      }
      borderColor={accent ? theme.primary : undefined}
      paddingLeft={padded ? spacing.sm : 0}
      paddingTop={padded ? 1 : 0}
      paddingBottom={padded ? 1 : 0}
    >
      {children}
    </box>
  );
}

/**
 * Status badge for card counts.
 */
interface StatusBadgeProps {
  count: number;
  label: string;
  variant: "new" | "due" | "total";
}

export function StatusBadge({ count, label, variant }: StatusBadgeProps) {
  const colors = {
    new: theme.cardNew,
    due: theme.cardDue,
    total: theme.textMuted,
  };

  return (
    <box flexDirection="row" gap={1}>
      <text fg={colors[variant]}>{count}</text>
      <text fg={theme.textSubtle}>{label}</text>
    </box>
  );
}

/**
 * Inline stats display for decks.
 */
interface StatsRowProps {
  total: number;
  newCards: number;
  dueCards: number;
  compact?: boolean;
}

export function StatsRow({
  total,
  newCards,
  dueCards,
  compact = false,
}: StatsRowProps) {
  if (compact) {
    return (
      <box flexDirection="row" gap={2}>
        <text fg={theme.cardNew}>{newCards}n</text>
        <text fg={theme.cardDue}>{dueCards}d</text>
      </box>
    );
  }

  return (
    <box flexDirection="row" gap={3}>
      <StatusBadge count={newCards} label="new" variant="new" />
      <StatusBadge count={dueCards} label="due" variant="due" />
      <StatusBadge count={total} label="total" variant="total" />
    </box>
  );
}

/**
 * Hint text for keyboard shortcuts.
 */
interface HintProps {
  children: ReactNode;
}

export function Hint({ children }: HintProps) {
  return <text fg={theme.textSubtle}>{children}</text>;
}

/**
 * Error display with icon.
 */
interface ErrorDisplayProps {
  title: string;
  message?: string;
}

export function ErrorDisplay({ title, message }: ErrorDisplayProps) {
  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" gap={2}>
        <text fg={theme.error}>{glyphs.diamond}</text>
        <text fg={theme.error}>{title}</text>
      </box>
      {message && (
        <text fg={theme.textMuted} marginLeft={3}>
          {message}
        </text>
      )}
    </box>
  );
}

/**
 * Empty state message.
 */
interface EmptyStateProps {
  message: string;
  hint?: string;
}

export function EmptyState({ message, hint }: EmptyStateProps) {
  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2}>
      <text fg={theme.textMuted}>{message}</text>
      {hint && <Hint>{hint}</Hint>}
    </box>
  );
}

/**
 * Separator line.
 */
interface SeparatorProps {
  width?: number;
}

export function Separator({ width = 40 }: SeparatorProps) {
  return (
    <text fg={theme.borderSubtle}>{glyphs.horizontalBar.repeat(width)}</text>
  );
}

/**
 * Key binding hint for footer.
 */
interface KeyBindingProps {
  keys: string;
  action: string;
}

export function KeyBinding({ keys, action }: KeyBindingProps) {
  return (
    <box flexDirection="row" gap={1}>
      <text fg={theme.textSubtle}>{keys}</text>
      <text fg={theme.textSubtle}>{action}</text>
    </box>
  );
}

/**
 * Footer with keyboard shortcuts.
 */
interface FooterProps {
  bindings: Array<{ keys: string; action: string }>;
}

export function Footer({ bindings }: FooterProps) {
  return (
    <box
      flexDirection="row"
      gap={3}
      marginTop={1}
      paddingLeft={1}
      paddingRight={1}
    >
      {bindings.map((b, i) => (
        <KeyBinding key={i} keys={b.keys} action={b.action} />
      ))}
    </box>
  );
}
