import { dnsmasqManager, type DnsmasqStatus } from "./dnsmasq-manager";
import {
  listPrivateIpv4Candidates,
  type LocalIpv4Candidate,
} from "./local-network";
import {
  configManager,
  DEFAULT_SMART_CONNECT_CONFIG,
  type AppConfig,
  type SmartConnectConfig,
  type SmartConnectRuntimeState,
} from "./redis";
import {
  getCapabilityUnavailableMessage,
  getRuntimeCapabilities,
} from "./runtime-profile";

export interface SmartConnectAvailability {
  available: boolean;
  reason: string;
}

export interface SmartConnectDetails {
  config: SmartConnectConfig;
  availability: SmartConnectAvailability;
  dnsmasq: DnsmasqStatus & {
    runtime: SmartConnectRuntimeState;
  };
  domains: string[];
  local_ip_options: LocalIpv4Candidate[];
}

const RUN_TYPE_LABELS = {
  0: "直连模式",
  1: "反代模式",
  3: "子域模式",
} as const;

const normalizeHost = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.+$/, "");

const isPrivateIpv4 = (value: string): boolean => {
  const [a, b] = value.split(".").map((item) => Number.parseInt(item, 10));
  if (
    a === undefined ||
    b === undefined ||
    !Number.isInteger(a) ||
    !Number.isInteger(b)
  ) {
    return false;
  }

  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
};

const getAvailability = (config: AppConfig): SmartConnectAvailability => {
  const runtimeCapabilities = getRuntimeCapabilities();
  if (!runtimeCapabilities.smart_connect_available) {
    return {
      available: false,
      reason: getCapabilityUnavailableMessage("smart_connect_available"),
    };
  }

  if (config.run_type === 3) {
    return {
      available: true,
      reason: "",
    };
  }

  return {
    available: false,
    reason: `仅子域模式可用，当前为${RUN_TYPE_LABELS[config.run_type] ?? "当前模式"}。`,
  };
};

const getSmartConnectConfigValue = (config: AppConfig): SmartConnectConfig => ({
  enabled: config.smart_connect?.enabled === true,
  selected_ipv4: String(
    config.smart_connect?.selected_ipv4 ??
      DEFAULT_SMART_CONNECT_CONFIG.selected_ipv4,
  ).trim(),
});

const buildRuntimeState = (input: {
  selectedIpv4: string;
  syncedDomains?: string[];
  managedRuleCount?: number;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
}): SmartConnectRuntimeState => ({
  selected_ipv4: input.selectedIpv4.trim(),
  synced_domains: [...(input.syncedDomains ?? [])],
  managed_rule_count: Math.max(0, Math.floor(input.managedRuleCount ?? 0)),
  last_sync_at: input.lastSyncAt ?? null,
  last_sync_error: input.lastSyncError?.trim() || null,
});

export const listSmartConnectDomains = (config: AppConfig): string[] => {
  const seen = new Set<string>();
  const authHosts: string[] = [];
  const appHosts: string[] = [];

  for (const mapping of config.host_mappings ?? []) {
    const host = normalizeHost(mapping.host);
    if (!host || seen.has(host)) {
      continue;
    }

    seen.add(host);
    if (mapping.service_role === "auth") {
      authHosts.push(host);
      continue;
    }

    appHosts.push(host);
  }

  return [...authHosts, ...appHosts];
};

export const compileSmartConnectState = (config: AppConfig) => {
  const smartConnectConfig = getSmartConnectConfigValue(config);
  return {
    config: smartConnectConfig,
    availability: getAvailability(config),
    domains: listSmartConnectDomains(config),
  };
};

export const getSmartConnectDetails = async (
  configInput?: AppConfig,
): Promise<SmartConnectDetails> => {
  const config = configInput ?? (await configManager.getConfig());
  const compiled = compileSmartConnectState(config);
  const [runtime, dnsmasqStatus] = await Promise.all([
    configManager.getSmartConnectRuntimeState(),
    dnsmasqManager.getStatus(),
  ]);

  return {
    config: compiled.config,
    availability: compiled.availability,
    dnsmasq: {
      ...dnsmasqStatus,
      runtime,
    },
    domains: compiled.domains,
    local_ip_options: listPrivateIpv4Candidates(),
  };
};

const saveSyncErrorRuntime = async (
  config: AppConfig,
  message: string,
): Promise<void> => {
  const smartConnectConfig = getSmartConnectConfigValue(config);
  const previousRuntime = await configManager.getSmartConnectRuntimeState();

  await configManager.saveSmartConnectRuntimeState({
    ...previousRuntime,
    selected_ipv4: smartConnectConfig.selected_ipv4,
    last_sync_error: message,
  });
};

export const syncSmartConnect = async (
  configInput?: AppConfig,
): Promise<SmartConnectDetails> => {
  const config = configInput ?? (await configManager.getConfig());
  const {
    config: smartConnectConfig,
    availability,
    domains,
  } = compileSmartConnectState(config);
  const now = new Date().toISOString();

  try {
    if (!availability.available || !smartConnectConfig.enabled) {
      const dnsmasqStatus = await dnsmasqManager.getStatus();
      if (dnsmasqStatus.installed) {
        await dnsmasqManager.clearManagedConfig();
      }

      await configManager.saveSmartConnectRuntimeState(
        buildRuntimeState({
          selectedIpv4: smartConnectConfig.selected_ipv4,
          syncedDomains: [],
          managedRuleCount: 0,
          lastSyncAt: now,
          lastSyncError: null,
        }),
      );

      return getSmartConnectDetails(config);
    }

    if (!smartConnectConfig.selected_ipv4) {
      throw new Error("请选择本机局域网 IP");
    }

    if (!isPrivateIpv4(smartConnectConfig.selected_ipv4)) {
      throw new Error("请选择有效的本机局域网 IPv4 地址");
    }

    const dnsmasqStatus = await dnsmasqManager.getStatus();
    if (!dnsmasqStatus.installed) {
      throw new Error("未检测到 dnsmasq，请先完成安装");
    }
    if (!dnsmasqStatus.initialized) {
      throw new Error("dnsmasq 尚未初始化完成，请先完成环境初始化");
    }

    await dnsmasqManager.applyManagedConfig({
      selectedIpv4: smartConnectConfig.selected_ipv4,
      domains,
    });

    await configManager.saveSmartConnectRuntimeState(
      buildRuntimeState({
        selectedIpv4: smartConnectConfig.selected_ipv4,
        syncedDomains: domains,
        managedRuleCount: domains.length,
        lastSyncAt: now,
        lastSyncError: null,
      }),
    );

    return getSmartConnectDetails(config);
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "智能连接同步失败";
    await saveSyncErrorRuntime(config, message);
    throw new Error(message);
  }
};

export const syncSmartConnectAfterHostMappingsChange = async (
  configInput?: AppConfig,
): Promise<SmartConnectDetails | null> => {
  const config = configInput ?? (await configManager.getConfig());
  if (config.run_type !== 3 || config.smart_connect?.enabled !== true) {
    return null;
  }

  return syncSmartConnect(config);
};

let hasQueuedSmartConnectSync = false;
let smartConnectBackgroundSyncPromise: Promise<void> | null = null;

const ensureSmartConnectBackgroundSyncWorker = (): void => {
  if (smartConnectBackgroundSyncPromise) {
    return;
  }

  smartConnectBackgroundSyncPromise = (async () => {
    while (hasQueuedSmartConnectSync) {
      hasQueuedSmartConnectSync = false;
      await syncSmartConnect();
    }
  })()
    .catch((error) => {
      console.error(
        "[smart-connect] failed to sync dnsmasq in background:",
        error,
      );
    })
    .finally(() => {
      smartConnectBackgroundSyncPromise = null;
      if (hasQueuedSmartConnectSync) {
        ensureSmartConnectBackgroundSyncWorker();
      }
    });
};

export const scheduleSmartConnectSync = (_configInput?: AppConfig): void => {
  hasQueuedSmartConnectSync = true;
  ensureSmartConnectBackgroundSyncWorker();
};

export const scheduleSmartConnectSyncAfterHostMappingsChange = (
  configInput?: AppConfig,
): void => {
  if (!configInput) {
    void configManager
      .getConfig()
      .then((config) => {
        scheduleSmartConnectSyncAfterHostMappingsChange(config);
      })
      .catch((error) => {
        console.error(
          "[smart-connect] failed to load config for host mapping background sync:",
          error,
        );
      });
    return;
  }

  if (
    configInput.run_type !== 3 ||
    configInput.smart_connect?.enabled !== true
  ) {
    return;
  }

  scheduleSmartConnectSync(configInput);
};

export const syncSmartConnectOnBoot = async (): Promise<void> => {
  const config = await configManager.getConfig();
  if (!getRuntimeCapabilities().smart_connect_available) {
    await configManager.saveSmartConnectRuntimeState(
      buildRuntimeState({
        selectedIpv4: config.smart_connect?.selected_ipv4 ?? "",
        syncedDomains: [],
        managedRuleCount: 0,
        lastSyncAt: new Date().toISOString(),
        lastSyncError: getCapabilityUnavailableMessage(
          "smart_connect_available",
        ),
      }),
    );
    return;
  }
  await syncSmartConnect(config);
};
