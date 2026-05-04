import {
  DUCKDNS_ACME_DNS_TYPE,
  ensureDuckDnsApiEndpoint,
  type AcmePatchLogger,
} from "./duckdns-api-endpoint";

export const applyAcmeDnsProviderPatches = async (options: {
  acmeHomeDir: string;
  dnsType: string;
  onLog?: AcmePatchLogger;
}): Promise<void> => {
  if (options.dnsType === DUCKDNS_ACME_DNS_TYPE) {
    await ensureDuckDnsApiEndpoint({
      acmeHomeDir: options.acmeHomeDir,
      onLog: options.onLog,
    });
  }
};
