import { createFileRoute } from "@tanstack/react-router";

import { ForgePage } from "@/components/forge/forge-page";

type ForgeSearch = {
  session: number | null;
  file: string | null;
};

const normalizeSession = (value: unknown): number | null => {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value === Math.floor(value)
  )
    return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0 && parsed === Math.floor(parsed)) return parsed;
  }
  return null;
};

const normalizeFile = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export const Route = createFileRoute("/forge")({
  validateSearch: (search): ForgeSearch => ({
    session: normalizeSession((search as Record<string, unknown>).session),
    file: normalizeFile((search as Record<string, unknown>).file),
  }),
  component: ForgeRoute,
});

function ForgeRoute() {
  const { session } = Route.useSearch();
  const navigate = Route.useNavigate();

  const onSessionChange = (next: { id: number; fileName: string } | null) => {
    void navigate({
      search: next ? { session: next.id, file: next.fileName } : { session: null, file: null },
      replace: true,
    });
  };

  return <ForgePage initialSessionId={session} onSessionChange={onSessionChange} />;
}
