import { createFileRoute } from "@tanstack/react-router";

import { ForgePage } from "@/components/forge/forge-page";

type ForgeSearch = {
  session: number | null;
  source: string | null;
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

const normalizeSource = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export const Route = createFileRoute("/forge")({
  validateSearch: (search): ForgeSearch => {
    const searchRecord = search as Record<string, unknown>;
    const session = normalizeSession(searchRecord.session);
    return {
      session,
      source: session !== null ? normalizeSource(searchRecord.source ?? searchRecord.file) : null,
    };
  },
  component: ForgeRoute,
});

function ForgeRoute() {
  const { session } = Route.useSearch();
  const navigate = Route.useNavigate();

  const onSessionChange = (next: { id: number; sourceLabel: string } | null) => {
    void navigate({
      search: next
        ? { session: next.id, source: next.sourceLabel }
        : { session: null, source: null },
      replace: true,
    });
  };

  return <ForgePage initialSessionId={session} onSessionChange={onSessionChange} />;
}
