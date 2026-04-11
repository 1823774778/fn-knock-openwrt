import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  AppConfig,
  HostMapping,
  ProxyMapping,
  ReverseProxySubmode,
  RunType,
  StreamMapping,
  SubdomainModeConfig,
} from "../types";
import { ConfigAPI } from "../lib/api";
import {
  getEffectiveRuntimeCapabilities,
  getEffectiveRuntimeProfile,
} from "../lib/docker-debug";

export const useConfigStore = defineStore("config", () => {
  const config = ref<AppConfig | null>(null);
  const isLoading = ref(true);
  const isError = ref(false);
  let hostMappingsFollowUpRefreshTimer: number | null = null;
  let hostMappingsFollowUpRefreshAttempts = 0;

  const hasPendingHostMappingMetadata = (mappings: HostMapping[]): boolean =>
    mappings.some(
      (mapping) =>
        Boolean(mapping.target.trim()) &&
        (!mapping.title.trim() || !mapping.favicon.trim()),
    );

  const refreshHostMappingsOnly = async () => {
    const nextMappings = await ConfigAPI.getHostMappings();
    if (config.value) {
      config.value = {
        ...config.value,
        host_mappings: nextMappings,
      };
    } else {
      await loadConfig();
    }
    return nextMappings;
  };

  const clearHostMappingsFollowUpRefresh = () => {
    if (hostMappingsFollowUpRefreshTimer !== null) {
      window.clearTimeout(hostMappingsFollowUpRefreshTimer);
      hostMappingsFollowUpRefreshTimer = null;
    }
    hostMappingsFollowUpRefreshAttempts = 0;
  };

  const scheduleHostMappingsFollowUpRefresh = (mappings: HostMapping[]) => {
    if (typeof window === "undefined") {
      return;
    }

    if (!hasPendingHostMappingMetadata(mappings)) {
      clearHostMappingsFollowUpRefresh();
      return;
    }

    clearHostMappingsFollowUpRefresh();
    hostMappingsFollowUpRefreshAttempts = 2;

    const runFollowUpRefresh = async () => {
      hostMappingsFollowUpRefreshTimer = null;

      try {
        const nextMappings = await refreshHostMappingsOnly();
        if (
          hostMappingsFollowUpRefreshAttempts > 0 &&
          hasPendingHostMappingMetadata(nextMappings)
        ) {
          hostMappingsFollowUpRefreshAttempts -= 1;
          hostMappingsFollowUpRefreshTimer = window.setTimeout(() => {
            void runFollowUpRefresh();
          }, 2500);
          return;
        }
      } catch (error) {
        console.error("Failed to refresh host mappings after save", error);
      }

      clearHostMappingsFollowUpRefresh();
    };

    hostMappingsFollowUpRefreshTimer = window.setTimeout(() => {
      void runFollowUpRefresh();
    }, 1800);
  };

  async function loadConfig() {
    isLoading.value = true;
    isError.value = false;
    try {
      config.value = await ConfigAPI.getConfig();
    } catch (e) {
      console.error(e);
      isError.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  async function saveDefaultRoute(path: string) {
    await ConfigAPI.updateDefaultRoute(path);
    if (config.value) config.value.default_route = path;
    await loadConfig();
  }

  async function setRunType(
    type: RunType,
    reverseProxySubmode?: ReverseProxySubmode,
  ) {
    await ConfigAPI.updateRunType({
      run_type: type,
      reverse_proxy_submode: reverseProxySubmode,
    });
    if (config.value) {
      config.value.run_type = type;
      if (type === 1 && reverseProxySubmode) {
        config.value.reverse_proxy_submode = reverseProxySubmode;
      }
    }
    await loadConfig(); // refresh to be safe
  }

  async function saveAutoManageFirewall(enabled: boolean) {
    const next = await ConfigAPI.updateAutoManageFirewall({
      auto_manage_firewall: enabled,
    });
    if (config.value) {
      config.value.auto_manage_firewall = next.auto_manage_firewall;
    } else {
      await loadConfig();
    }
    return next;
  }

  async function saveProxyMappings(mappings: ProxyMapping[]) {
    await ConfigAPI.updateProxyMappings(mappings);
    await loadConfig();
  }

  async function saveHostMappings(mappings: HostMapping[]) {
    const nextMappings = await ConfigAPI.updateHostMappings(mappings);
    if (!config.value) {
      scheduleHostMappingsFollowUpRefresh(nextMappings);
      await loadConfig();
      return nextMappings;
    }

    config.value = {
      ...config.value,
      host_mappings: nextMappings,
    };
    scheduleHostMappingsFollowUpRefresh(nextMappings);
    return nextMappings;
  }

  async function refreshAllHostMappingTitles() {
    const result = await ConfigAPI.refreshAllHostMappingTitles();
    await loadConfig();
    return result;
  }

  async function saveStreamMappings(mappings: StreamMapping[]) {
    await ConfigAPI.updateStreamMappings(mappings);
    await loadConfig();
  }

  async function saveSubdomainMode(next: Partial<SubdomainModeConfig>) {
    const result = await ConfigAPI.updateSubdomainMode(next);
    await loadConfig();
    return result;
  }

  const runtimeProfile = computed(() =>
    getEffectiveRuntimeProfile(config.value?.runtime_profile),
  );
  const capabilities = computed(() =>
    getEffectiveRuntimeCapabilities(config.value?.capabilities),
  );
  const isDockerDeployment = computed(
    () => runtimeProfile.value?.is_docker === true,
  );
  const canUseDirectMode = computed(
    () => capabilities.value?.direct_mode_available === true,
  );
  const canManageHostFirewall = computed(
    () => capabilities.value?.host_firewall_available === true,
  );
  const canUseSmartConnect = computed(
    () => capabilities.value?.smart_connect_available === true,
  );
  const canSelfUpdate = computed(
    () => capabilities.value?.self_update_available === true,
  );
  const canSyncSystemClock = computed(
    () => capabilities.value?.system_clock_sync_available === true,
  );
  const canUseTerminal = computed(
    () => capabilities.value?.terminal_available === true,
  );
  const hasSharedRoot = computed(
    () => capabilities.value?.shared_root_available === true,
  );

  return {
    config,
    isLoading,
    isError,
    isDockerDeployment,
    canUseDirectMode,
    canManageHostFirewall,
    canUseSmartConnect,
    canSelfUpdate,
    canSyncSystemClock,
    canUseTerminal,
    hasSharedRoot,
    loadConfig,
    setRunType,
    saveAutoManageFirewall,
    saveProxyMappings,
    saveHostMappings,
    refreshAllHostMappingTitles,
    saveStreamMappings,
    saveSubdomainMode,
    saveDefaultRoute,
  };
});
