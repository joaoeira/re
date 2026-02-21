export const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const toIsoOrNull = (value: Date | null): string | null =>
  value ? value.toISOString() : null;
