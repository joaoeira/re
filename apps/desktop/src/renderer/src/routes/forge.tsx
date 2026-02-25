import { createFileRoute } from "@tanstack/react-router";

import { ForgePage } from "@/components/forge/forge-page";

export const Route = createFileRoute("/forge")({
  component: ForgeRoute,
});

function ForgeRoute() {
  return <ForgePage />;
}
