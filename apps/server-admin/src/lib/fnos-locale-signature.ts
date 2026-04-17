const FNOS_DETECTION_MIN_MATCHED_APP_KEYS = 4;
const FNOS_DETECTION_APP_KEYS = [
  "account",
  "appStore",
  "docker",
  "fileManager",
  "mediaCenter",
  "photos",
  "recycleBin",
  "resourceManager",
  "setting",
  "system",
  "vm",
] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const isFnosLocalePayload = (value: unknown): boolean => {
  if (!isPlainObject(value)) return false;

  const app = value.app;
  const appApiErrors = value.appApiErrors;
  if (!isPlainObject(app) || !isPlainObject(appApiErrors)) {
    return false;
  }

  const matchedAppKeys = FNOS_DETECTION_APP_KEYS.filter((key) =>
    isNonEmptyString(app[key]),
  ).length;
  if (matchedAppKeys < FNOS_DETECTION_MIN_MATCHED_APP_KEYS) {
    return false;
  }

  return isNonEmptyString(appApiErrors.AuthFailed);
};
