export type DnsProvider = {
  dnsType: string;
  label: string;
  group: string;
  credentialSchemes: DnsCredentialScheme[];
};

export type DnsCredentialField = {
  key: string;
  label?: string;
  description?: string;
  required?: boolean;
};

export type DnsCredentialScheme = {
  id: string;
  label: string;
  description?: string;
  fields: DnsCredentialField[];
};

type CredentialSchemeOptions = {
  description?: string;
  optionalKeys?: string[];
  fields?: Partial<Record<string, Omit<DnsCredentialField, "key">>>;
};

const createCredentialScheme = (
  id: string,
  label: string,
  fieldKeys: string[],
  options?: CredentialSchemeOptions,
): DnsCredentialScheme => {
  const optionalKeys = new Set(options?.optionalKeys || []);

  return {
    id,
    label,
    description: options?.description,
    fields: fieldKeys.map((key) => ({
      key,
      required: !optionalKeys.has(key),
      ...(options?.fields?.[key] || {}),
    })),
  };
};

const createSingleSchemeProvider = (
  dnsType: string,
  label: string,
  group: string,
  envKeys: string[],
  options?: CredentialSchemeOptions,
): DnsProvider => ({
  dnsType,
  label,
  group,
  credentialSchemes: [
    createCredentialScheme("default", "默认凭据", envKeys, options),
  ],
});

export const dnsProviders: DnsProvider[] = [
  {
    dnsType: "dns_cf",
    label: "Cloudflare",
    group: "常用",
    credentialSchemes: [
      createCredentialScheme(
        "global-key",
        "Global API Key",
        ["CF_Key", "CF_Email"],
        {
          description: "兼容 Cloudflare 旧版 Global API Key 方式。",
          fields: {
            CF_Key: { label: "Global API Key" },
            CF_Email: { label: "账户邮箱" },
          },
        },
      ),
      createCredentialScheme(
        "api-token",
        "API Token",
        ["CF_Token", "CF_Zone_ID", "CF_Account_ID"],
        {
          description:
            "推荐。仅需填写 Token；如已知 Zone ID 或 Account ID，可一并填写以减少自动探测。",
          optionalKeys: ["CF_Zone_ID", "CF_Account_ID"],
          fields: {
            CF_Token: { label: "API Token" },
            CF_Zone_ID: { label: "Zone ID" },
            CF_Account_ID: { label: "Account ID" },
          },
        },
      ),
    ],
  },
  createSingleSchemeProvider("dns_ali", "阿里云 DNS", "常用", [
    "Ali_Key",
    "Ali_Secret",
  ]),
  createSingleSchemeProvider("dns_dp", "DNSPod", "常用", ["DP_Id", "DP_Key"]),
  createSingleSchemeProvider(
    "dns_tencent",
    "腾讯云 DNSPod (TencentCloud)",
    "常用",
    ["Tencent_SecretId", "Tencent_SecretKey"],
  ),
  createSingleSchemeProvider("dns_duckdns", "DuckDNS", "常用", [
    "DuckDNS_Token",
  ]),
  createSingleSchemeProvider("dns_gd", "GoDaddy", "常用", [
    "GD_Key",
    "GD_Secret",
  ]),
  createSingleSchemeProvider("dns_dgon", "DigitalOcean", "常用", [
    "DO_API_KEY",
  ]),
  createSingleSchemeProvider("dns_netlify", "Netlify", "常用", [
    "NETLIFY_ACCESS_TOKEN",
  ]),
  createSingleSchemeProvider("dns_vercel", "Vercel", "常用", ["VERCEL_TOKEN"]),
  createSingleSchemeProvider("dns_aws", "AWS Route53", "常用", [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ]),
  createSingleSchemeProvider(
    "dns_gcloud",
    "Google Cloud DNS (gcloud)",
    "常用",
    ["CLOUDSDK_ACTIVE_CONFIG_NAME"],
    {
      description:
        "依赖运行环境中的 gcloud 命令和已授权配置；未填写时使用 gcloud 默认配置。",
      optionalKeys: ["CLOUDSDK_ACTIVE_CONFIG_NAME"],
    },
  ),
  {
    dnsType: "dns_azure",
    label: "Azure DNS",
    group: "常用",
    credentialSchemes: [
      createCredentialScheme("service-principal", "Service Principal", [
        "AZUREDNS_SUBSCRIPTIONID",
        "AZUREDNS_TENANTID",
        "AZUREDNS_APPID",
        "AZUREDNS_CLIENTSECRET",
      ]),
      createCredentialScheme("bearer-token", "Bearer Token", [
        "AZUREDNS_SUBSCRIPTIONID",
        "AZUREDNS_BEARERTOKEN",
      ]),
      createCredentialScheme(
        "managed-identity",
        "Managed Identity",
        ["AZUREDNS_SUBSCRIPTIONID", "AZUREDNS_MANAGEDIDENTITY"],
        {
          description: "AZUREDNS_MANAGEDIDENTITY 填写 true。",
        },
      ),
    ],
  },
  createSingleSchemeProvider("dns_porkbun", "Porkbun", "常用", [
    "PORKBUN_API_KEY",
    "PORKBUN_SECRET_API_KEY",
  ]),
  {
    dnsType: "dns_dynv6",
    label: "dynv6",
    group: "常用",
    credentialSchemes: [
      createCredentialScheme("rest-token", "REST API Token", ["DYNV6_TOKEN"]),
      createCredentialScheme("ssh-key", "SSH Key", ["KEY"], {
        fields: {
          KEY: { label: "SSH 私钥文件路径" },
        },
      }),
    ],
  },
  createSingleSchemeProvider("dns_huaweicloud", "华为云 DNS", "国内", [
    "HUAWEICLOUD_Username",
    "HUAWEICLOUD_Password",
    "HUAWEICLOUD_DomainName",
  ]),
  createSingleSchemeProvider("dns_jd", "京东云 DNS", "国内", [
    "JD_ACCESS_KEY_ID",
    "JD_ACCESS_KEY_SECRET",
    "JD_REGION",
  ]),
  createSingleSchemeProvider("dns_la", "DNS.LA", "国内", ["LA_Id", "LA_Sk"]),
  createSingleSchemeProvider("dns_west_cn", "西部数码", "国内", [
    "WEST_Username",
    "WEST_Key",
  ]),
  createSingleSchemeProvider("dns_linode_v4", "Linode", "国际", [
    "LINODE_V4_API_KEY",
  ]),
  createSingleSchemeProvider("dns_vultr", "Vultr", "国际", ["VULTR_API_KEY"]),
  createSingleSchemeProvider(
    "dns_ovh",
    "OVH",
    "国际",
    ["OVH_AK", "OVH_AS", "OVH_CK", "OVH_END_POINT"],
    {
      optionalKeys: ["OVH_END_POINT"],
    },
  ),
  createSingleSchemeProvider("dns_hetzner", "Hetzner", "国际", [
    "HETZNER_Token",
  ]),
  createSingleSchemeProvider("dns_namecheap", "Namecheap", "国际", [
    "NAMECHEAP_API_KEY",
    "NAMECHEAP_USERNAME",
    "NAMECHEAP_SOURCEIP",
  ]),
  createSingleSchemeProvider("dns_namecom", "Name.com", "国际", [
    "Namecom_Username",
    "Namecom_Token",
  ]),
  createSingleSchemeProvider("dns_namesilo", "NameSilo", "国际", [
    "Namesilo_Key",
  ]),
  createSingleSchemeProvider("dns_dreamhost", "DreamHost", "国际", [
    "DH_API_KEY",
  ]),
  createSingleSchemeProvider("dns_freedns", "FreeDNS", "国际", [
    "FREEDNS_User",
    "FREEDNS_Password",
  ]),
  createSingleSchemeProvider("dns_dyn", "Dyn Managed DNS", "国际", [
    "DYN_Customer",
    "DYN_Username",
    "DYN_Password",
  ]),
  createSingleSchemeProvider("dns_dynu", "Dynu", "国际", [
    "Dynu_ClientId",
    "Dynu_Secret",
  ]),
  createSingleSchemeProvider("dns_bunny", "Bunny DNS", "国际", [
    "BUNNY_API_KEY",
  ]),
  createSingleSchemeProvider("dns_desec", "deSEC", "国际", ["DEDYN_TOKEN"]),
  createSingleSchemeProvider("dns_freemyip", "FreeMyIP", "国际", [
    "FREEMYIP_Token",
  ]),
  createSingleSchemeProvider("dns_ipv64", "IPv64.net", "国际", ["IPv64_Token"]),
  createSingleSchemeProvider("dns_scaleway", "Scaleway", "国际", [
    "SCALEWAY_API_TOKEN",
  ]),
  createSingleSchemeProvider("dns_easydns", "easyDNS", "国际", [
    "EASYDNS_Token",
    "EASYDNS_Key",
  ]),
  createSingleSchemeProvider("dns_zoneedit", "ZoneEdit", "国际", [
    "ZONEEDIT_ID",
    "ZONEEDIT_Token",
  ]),
  createSingleSchemeProvider("dns_zonomi", "Zonomi", "国际", ["ZM_Key"]),
  createSingleSchemeProvider("dns_dnsexit", "DNSExit", "国际", [
    "DNSEXIT_API_KEY",
    "DNSEXIT_AUTH_USER",
    "DNSEXIT_AUTH_PASS",
  ]),
  {
    dnsType: "dns_yandex360",
    label: "Yandex 360",
    group: "国际",
    credentialSchemes: [
      createCredentialScheme(
        "oauth-client",
        "OAuth Client",
        ["YANDEX360_CLIENT_ID", "YANDEX360_CLIENT_SECRET", "YANDEX360_ORG_ID"],
        {
          optionalKeys: ["YANDEX360_ORG_ID"],
        },
      ),
      createCredentialScheme(
        "access-token",
        "Access Token",
        ["YANDEX360_ACCESS_TOKEN", "YANDEX360_ORG_ID"],
        {
          optionalKeys: ["YANDEX360_ORG_ID"],
        },
      ),
    ],
  },
  createSingleSchemeProvider("dns_mydnsjp", "MyDNS.JP", "国际", [
    "MYDNSJP_MasterID",
    "MYDNSJP_Password",
  ]),
  createSingleSchemeProvider("dns_gandi_livedns", "Gandi LiveDNS", "国际", [
    "GANDI_LIVEDNS_KEY",
  ]),
  createSingleSchemeProvider("dns_nsone", "NS1", "国际", ["NS1_Key"]),
  createSingleSchemeProvider("dns_dnsimple", "DNSimple", "国际", [
    "DNSimple_OAUTH_TOKEN",
  ]),
  {
    dnsType: "dns_cloudns",
    label: "ClouDNS",
    group: "国际",
    credentialSchemes: [
      createCredentialScheme("auth-id", "Auth ID", [
        "CLOUDNS_AUTH_ID",
        "CLOUDNS_AUTH_PASSWORD",
      ]),
      createCredentialScheme("sub-auth-id", "Sub Auth ID", [
        "CLOUDNS_SUB_AUTH_ID",
        "CLOUDNS_AUTH_PASSWORD",
      ]),
    ],
  },
  createSingleSchemeProvider("dns_he", "Hurricane Electric", "国际", [
    "HE_Username",
    "HE_Password",
  ]),
  createSingleSchemeProvider("dns_transip", "TransIP", "国际", [
    "TRANSIP_Username",
    "TRANSIP_Key_File",
  ]),
  createSingleSchemeProvider("dns_doapi", "Domain-Offensive", "国际", [
    "DO_LETOKEN",
  ]),
  createSingleSchemeProvider(
    "dns_acmedns",
    "acme-dns",
    "自建/高级",
    [
      "ACMEDNS_USERNAME",
      "ACMEDNS_PASSWORD",
      "ACMEDNS_SUBDOMAIN",
      "ACMEDNS_BASE_URL",
    ],
    {
      optionalKeys: ["ACMEDNS_BASE_URL"],
    },
  ),
  createSingleSchemeProvider(
    "dns_nsupdate",
    "nsupdate",
    "自建/高级",
    [
      "NSUPDATE_SERVER",
      "NSUPDATE_SERVER_PORT",
      "NSUPDATE_KEY",
      "NSUPDATE_ZONE",
    ],
    {
      optionalKeys: ["NSUPDATE_SERVER_PORT", "NSUPDATE_KEY", "NSUPDATE_ZONE"],
    },
  ),
  createSingleSchemeProvider(
    "dns_pdns",
    "PowerDNS",
    "自建/高级",
    ["PDNS_Url", "PDNS_ServerId", "PDNS_Token", "PDNS_Ttl"],
    {
      optionalKeys: ["PDNS_Ttl"],
    },
  ),
  createSingleSchemeProvider(
    "dns_technitium",
    "Technitium DNS",
    "自建/高级",
    ["Technitium_Server", "Technitium_Token", "Technitium_Expiry_Ttl"],
    {
      optionalKeys: ["Technitium_Expiry_Ttl"],
    },
  ),
  createSingleSchemeProvider("dns_pleskxml", "Plesk XML API", "自建/高级", [
    "pleskxml_uri",
    "pleskxml_user",
    "pleskxml_pass",
  ]),
  createSingleSchemeProvider("dns_cpanel", "cPanel", "自建/高级", [
    "cPanel_Username",
    "cPanel_Apitoken",
    "cPanel_Hostname",
  ]),
  createSingleSchemeProvider(
    "dns_da",
    "DirectAdmin",
    "自建/高级",
    ["DA_Api", "DA_Api_Insecure"],
    {
      fields: {
        DA_Api_Insecure: { description: "填写 0 或 1。" },
      },
    },
  ),
  createSingleSchemeProvider(
    "dns_ispconfig",
    "ISPConfig",
    "自建/高级",
    ["ISPC_User", "ISPC_Password", "ISPC_Api", "ISPC_Api_Insecure"],
    {
      fields: {
        ISPC_Api_Insecure: { description: "填写 0 或 1。" },
      },
    },
  ),
  createSingleSchemeProvider(
    "dns_opnsense",
    "OPNsense",
    "自建/高级",
    ["OPNs_Host", "OPNs_Port", "OPNs_Key", "OPNs_Token", "OPNs_Api_Insecure"],
    {
      optionalKeys: ["OPNs_Port", "OPNs_Api_Insecure"],
      fields: {
        OPNs_Api_Insecure: { description: "可选，填写 0 或 1。" },
      },
    },
  ),
];

const dnsTypeAliases: Record<string, string> = {
  aliyun: "dns_ali",
  cloudflare: "dns_cf",
  dnspod: "dns_dp",
  tencentcloud: "dns_tencent",
  duckdns: "dns_duckdns",
  google: "dns_gcloud",
  gcloud: "dns_gcloud",
  dns_google: "dns_gcloud",
  huaweicloud: "dns_huaweicloud",
  huawei: "dns_huaweicloud",
  netlify: "dns_netlify",
};

const credentialAliases: Record<string, Record<string, string>> = {
  dns_netlify: {
    NETLIFY_TOKEN: "NETLIFY_ACCESS_TOKEN",
  },
};

const normalizeCredentialRecord = (value: unknown) => {
  const out: Record<string, string> = {};
  if (!value || typeof value !== "object") return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const kk = String(k ?? "").trim();
    const vv = String(v ?? "").trim();
    if (!kk || !vv) continue;
    out[kk] = vv;
  }
  return out;
};

export const normalizeAcmeDnsType = (value: string | undefined | null) => {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;

  const lower = v.toLowerCase();
  if (dnsTypeAliases[lower]) return dnsTypeAliases[lower];
  if (/^dns_[a-z0-9_]+$/i.test(v)) return lower;
  return null;
};

export const getProviderAllCredentialKeys = (provider: DnsProvider) => {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const scheme of provider.credentialSchemes) {
    for (const field of scheme.fields) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      keys.push(field.key);
    }
  }
  return keys;
};

export const getSatisfiedCredentialScheme = (
  provider: DnsProvider,
  credentials: Record<string, string>,
) => {
  return (
    provider.credentialSchemes.find((scheme) =>
      scheme.fields
        .filter((field) => field.required !== false)
        .every((field) => Boolean(credentials[field.key])),
    ) || null
  );
};

export const formatCredentialRequirements = (provider: DnsProvider) => {
  if (provider.credentialSchemes.length === 1) {
    const requiredKeys = provider.credentialSchemes[0]!.fields.filter(
      (field) => field.required !== false,
    ).map((field) => field.key);
    return requiredKeys.join(", ");
  }

  return provider.credentialSchemes
    .map((scheme) => {
      const requiredKeys = scheme.fields
        .filter((field) => field.required !== false)
        .map((field) => field.key)
        .join(", ");
      const optionalKeys = scheme.fields
        .filter((field) => field.required === false)
        .map((field) => field.key);
      const suffix = optionalKeys.length
        ? `；可选 ${optionalKeys.join(", ")}`
        : "";
      return `${scheme.label}: ${requiredKeys}${suffix}`;
    })
    .join("；或 ");
};

export const normalizeAcmeEnvVars = (
  dnsType: string | undefined | null,
  credentials: Record<string, string> | undefined | null,
) => {
  const normalized = normalizeCredentialRecord(credentials);
  const normalizedDnsType = normalizeAcmeDnsType(dnsType) || "";
  const aliases = credentialAliases[normalizedDnsType] || {};

  for (const [from, to] of Object.entries(aliases)) {
    if (!normalized[to] && normalized[from]) {
      normalized[to] = normalized[from];
    }
  }

  return normalized;
};

export const filterAcmeCredentialsForProvider = (
  provider: DnsProvider,
  credentials: Record<string, string> | undefined | null,
) => {
  const allowedCredentialKeys = new Set(getProviderAllCredentialKeys(provider));
  return Object.fromEntries(
    Object.entries(normalizeAcmeEnvVars(provider.dnsType, credentials)).filter(
      ([key]) => allowedCredentialKeys.has(key),
    ),
  );
};

export const getProviderLabel = (dnsType: string | null | undefined) => {
  const normalized =
    normalizeAcmeDnsType(dnsType) || String(dnsType || "").trim();
  if (!normalized) return "-";
  return (
    dnsProviders.find((provider) => provider.dnsType === normalized)?.label ||
    normalized
  );
};
