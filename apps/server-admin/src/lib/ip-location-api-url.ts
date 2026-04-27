const SELF_HOSTED_API_PREFIX = "/api/v1";

export const normalizeIpLocationServiceUrl = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .replace(/\/+$/, "");

export const resolveIpLocationApiBaseUrl = (value: string): string => {
  const normalized = normalizeIpLocationServiceUrl(value);
  const url = new URL(normalized);
  const pathname = url.pathname.replace(/\/+$/, "");

  url.pathname =
    !pathname || pathname === "/" ? SELF_HOSTED_API_PREFIX : pathname;
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/+$/, "");
};

export const buildIpLocationApiUrl = (baseUrl: string, path: string): URL => {
  const apiBaseUrl = resolveIpLocationApiBaseUrl(baseUrl);
  return new URL(path.replace(/^\/+/, ""), `${apiBaseUrl}/`);
};
