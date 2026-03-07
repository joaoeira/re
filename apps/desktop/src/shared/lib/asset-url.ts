export const DESKTOP_ASSET_URL_SCHEME = "re-asset";
const DESKTOP_ASSET_URL_HOST = "asset";
export const DESKTOP_CANONICAL_ASSET_PREFIX = ".re/assets/";

export const toDesktopAssetUrl = (workspaceRelativePath: string): string => {
  const encodedPath = workspaceRelativePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${DESKTOP_ASSET_URL_SCHEME}://${DESKTOP_ASSET_URL_HOST}/${encodedPath}`;
};

export const fromDesktopAssetUrl = (rawUrl: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${DESKTOP_ASSET_URL_SCHEME}:`) {
    return null;
  }

  const segments = parsed.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });

  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  const path = segments.join("/");

  return path.length > 0 ? path : null;
};
