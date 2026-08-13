import { LaunchType, launchCommand } from "@raycast/api";

export const refreshReviewStatusMenu = async (): Promise<void> => {
  try {
    await launchCommand({
      name: "review-status",
      type: LaunchType.Background,
    });
  } catch {
    // The menu command can be disabled without affecting card creation or review.
  }
};
