import { describe, expect, it } from "vitest";

import { parseGitStatusPorcelainV2 } from "@main/git/sync-service";

describe("parseGitStatusPorcelainV2", () => {
  it("extracts ahead/behind counts and local change flags", () => {
    const parsed = parseGitStatusPorcelainV2(`# branch.oid abcdef
# branch.head master
# branch.upstream origin/master
# branch.ab +2 -3
1 MM N... 100644 100644 100644 abcdef abcdef cards.md
? new-card.md
u UU N... 100644 100644 100644 100644 abcdef abcdef abcdef conflicted.md
`);

    expect(parsed).toEqual({
      ahead: 2,
      behind: 3,
      hasStagedChanges: true,
      hasUnstagedChanges: true,
      hasUntrackedChanges: true,
      hasUnmergedChanges: true,
      hasLocalChanges: true,
    });
  });
});
