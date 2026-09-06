import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Resolve the Effect adapter against this package’s Vitest version.
    server: { deps: { inline: ["@effect/vitest"] } },
    include: ["test/**/*.test.ts"],
  },
});
