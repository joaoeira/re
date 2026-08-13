import {
  Icon,
  LaunchType,
  MenuBarExtra,
  getPreferenceValues,
  launchCommand,
  openExtensionPreferences,
} from "@raycast/api";
import { useCallback, useEffect, useState } from "react";

import { getReviewStatusForUi, type ReviewStatusUiResult } from "./review";
import { refreshReviewStatusMenu } from "./review-status-refresh";
import { runRaycastEffect } from "./runtime";

const countLabel = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

const launchExtensionCommand = (name: "create-card" | "review-cards") =>
  launchCommand({ name, type: LaunchType.UserInitiated });

export default function ReviewStatusCommand() {
  const preferences = getPreferenceValues<Preferences.ReviewStatus>();
  const [status, setStatus] = useState<ReviewStatusUiResult>();
  const [isLoading, setIsLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    const result = await runRaycastEffect(getReviewStatusForUi(preferences.workspacePath));
    setStatus(result);
    setIsLoading(false);
  }, [preferences.workspacePath]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const due = status?._tag === "ReviewStatusLoaded" ? status.due : 0;
  const tooltip =
    status === undefined
      ? "Loading review status"
      : status._tag === "ReviewStatusError"
        ? "Could not load review status"
        : due === 0
          ? "No cards due now"
          : countLabel(due, "card due now", "cards due now");

  return (
    <MenuBarExtra
      icon={Icon.Layers}
      {...(due === 0 ? {} : { title: String(due) })}
      tooltip={tooltip}
      isLoading={isLoading}
    >
      {status?._tag === "ReviewStatusLoaded" ? (
        <>
          <MenuBarExtra.Section>
            <MenuBarExtra.Item
              title={countLabel(status.due, "card due now", "cards due now")}
              icon={status.due === 0 ? Icon.CheckCircle : Icon.Clock}
            />
            <MenuBarExtra.Item
              title={countLabel(status.new, "new card", "new cards")}
              icon={Icon.PlusCircle}
            />
            {status.unavailableDecks > 0 && (
              <MenuBarExtra.Item
                title={countLabel(status.unavailableDecks, "deck unavailable", "decks unavailable")}
                icon={Icon.Warning}
              />
            )}
          </MenuBarExtra.Section>
          <MenuBarExtra.Section>
            <MenuBarExtra.Item
              title="Review Cards"
              icon={Icon.Eye}
              onAction={() => void launchExtensionCommand("review-cards")}
            />
            <MenuBarExtra.Item
              title="Create Card"
              icon={Icon.Plus}
              onAction={() => void launchExtensionCommand("create-card")}
            />
          </MenuBarExtra.Section>
        </>
      ) : status?._tag === "ReviewStatusError" ? (
        <MenuBarExtra.Section>
          <MenuBarExtra.Item title="Could not load review status" icon={Icon.Warning} />
          <MenuBarExtra.Item title={status.message} />
        </MenuBarExtra.Section>
      ) : null}
      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="Refresh"
          icon={Icon.ArrowClockwise}
          onAction={() => void refreshReviewStatusMenu()}
        />
        <MenuBarExtra.Item
          title="Open Extension Preferences"
          icon={Icon.Gear}
          onAction={openExtensionPreferences}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
