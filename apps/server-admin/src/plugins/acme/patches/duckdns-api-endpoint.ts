import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileExists } from "../../../lib/runtime";

export type AcmePatchLogger = (line: string) => Promise<void> | void;

const DUCKDNS_DEFAULT_API_URL = "https://www.duckdns.org/update";
const DUCKDNS_PROXY_API_URL = "https://duckdns.fnknock.cn/update";
const DUCKDNS_DEFAULT_API_PATTERN =
  /^([ \t]*)DuckDNS_API=(["'])https:\/\/www\.duckdns\.org\/update\2[ \t]*$/m;
const DUCKDNS_PROXY_API_PATTERN =
  /^[ \t]*DuckDNS_API=(["'])https:\/\/duckdns\.fnknock\.cn\/update\1[ \t]*$/m;

export const DUCKDNS_ACME_DNS_TYPE = "dns_duckdns";

export const ensureDuckDnsApiEndpoint = async (options: {
  acmeHomeDir: string;
  onLog?: AcmePatchLogger;
}): Promise<void> => {
  const scriptPath = join(options.acmeHomeDir, "dnsapi", "dns_duckdns.sh");
  if (!(await fileExists(scriptPath))) {
    throw new Error(`未找到 DuckDNS DNS API 脚本: ${scriptPath}`);
  }

  const content = await readFile(scriptPath, "utf-8");
  if (
    DUCKDNS_PROXY_API_PATTERN.test(content) &&
    !DUCKDNS_DEFAULT_API_PATTERN.test(content)
  ) {
    return;
  }

  if (!DUCKDNS_DEFAULT_API_PATTERN.test(content)) {
    return;
  }

  const updated = content.replace(
    DUCKDNS_DEFAULT_API_PATTERN,
    (_line, indent: string, quote: string) =>
      `${indent}DuckDNS_API=${quote}${DUCKDNS_PROXY_API_URL}${quote}`,
  );
  if (updated === content) return;

  await writeFile(scriptPath, updated, "utf-8");
  if (options.onLog) {
    await options.onLog(
      `已将 DuckDNS API 从 ${DUCKDNS_DEFAULT_API_URL} 切换为 ${DUCKDNS_PROXY_API_URL}`,
    );
  }
};
