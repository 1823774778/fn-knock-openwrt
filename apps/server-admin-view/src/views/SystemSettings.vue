<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RunModeSettings from "./system-settings/RunModeSettings.vue";
import FrpSettings from "./system-settings/FrpSettings.vue";
import CloudflaredSettings from "./system-settings/CloudflaredSettings.vue";
import AcmeSSL from "./system-settings/AcmeSSL.vue";
import IpLocationSettings from "./system-settings/IpLocationSettings.vue";
import ScannerFirewallSettings from "./system-settings/ScannerFirewallSettings.vue";
import FeaturesSettings from "./system-settings/FeaturesSettings.vue";
import FnosSettings from "./system-settings/FnosSettings.vue";
import CaptchaSettings from "./system-settings/CaptchaSettings.vue";
import GatewayLoggingSettings from "./system-settings/GatewayLoggingSettings.vue";
import GatewaySettings from "./system-settings/GatewaySettings.vue";
import WAFSettings from "./system-settings/WAFSettings.vue";
import TerminalSettings from "./system-settings/TerminalSettings.vue";
import SessionSettings from "./system-settings/SessionSettings.vue";
import MaintenanceSettings from "./system-settings/MaintenanceSettings.vue";
import PanelSettings from "./system-settings/PanelSettings.vue";
import { useSyncedQueryTab } from "@admin-shared/composables/useSyncedQueryTab";
import { useConfigStore } from "../store/config";
import { isCloudflaredTunnelAvailable } from "../lib/reverse-proxy-submode";

const router = useRouter();
const route = useRoute();
const configStore = useConfigStore();

const defaultTab = "run-mode";
const showTunnelTabs = computed(() => configStore.config?.run_type === 1);
const showCloudflaredTab = computed(() =>
  isCloudflaredTunnelAvailable(configStore.config),
);
const showTerminalTab = computed(() => configStore.canUseTerminal);
const showPanelTab = computed(() => configStore.isDockerDeployment);
const allowedTabs = computed(() => {
  const tabs = [
    "run-mode",
    "acme-ssl",
    "ip-location",
    "fnos",
    "scanner-firewall",
    "features",
    "gateway",
    "waf",
    "gateway-logging",
    "session",
    "panel",
    "captcha",
    "maintenance",
  ];
  if (showTerminalTab.value) {
    tabs.splice(7, 0, "terminal");
  }
  if (!showPanelTab.value) {
    const panelIndex = tabs.indexOf("panel");
    if (panelIndex >= 0) {
      tabs.splice(panelIndex, 1);
    }
  }
  if (showTunnelTabs.value) {
    tabs.splice(1, 0, "frp");
    if (showCloudflaredTab.value) {
      tabs.splice(2, 0, "cloudflared");
    }
  }
  return tabs;
});
const { currentTab, navigateTo } = useSyncedQueryTab({
  route,
  router,
  defaultTab,
  allowedTabs,
});
</script>

<template>
  <div class="h-full flex flex-col gap-4">
    <Tabs
      :model-value="currentTab"
      @update:model-value="navigateTo"
      class="w-full"
    >
      <div class="w-full overflow-x-auto pb-1">
        <TabsList class="min-w-max justify-start">
          <TabsTrigger value="run-mode" class="flex-none shrink-0 px-3"
            >模式</TabsTrigger
          >
          <TabsTrigger
            v-if="showTunnelTabs"
            value="frp"
            class="flex-none shrink-0 px-3"
            >FRP</TabsTrigger
          >
          <TabsTrigger
            v-if="showTunnelTabs && showCloudflaredTab"
            value="cloudflared"
            class="flex-none shrink-0 px-3"
            >Cloudflared</TabsTrigger
          >
          <TabsTrigger value="acme-ssl" class="flex-none shrink-0 px-3"
            >ACME</TabsTrigger
          >
          <TabsTrigger value="ip-location" class="flex-none shrink-0 px-3"
            >属地</TabsTrigger
          >
          <TabsTrigger value="fnos" class="flex-none shrink-0 px-3"
            >飞牛</TabsTrigger
          >
          <TabsTrigger value="scanner-firewall" class="flex-none shrink-0 px-3"
            >拦截</TabsTrigger
          >
          <TabsTrigger value="features" class="flex-none shrink-0 px-3"
            >功能</TabsTrigger
          >
          <TabsTrigger value="gateway" class="flex-none shrink-0 px-3"
            >网关</TabsTrigger
          >
          <TabsTrigger value="waf" class="flex-none shrink-0 px-3"
            >WAF</TabsTrigger
          >
          <TabsTrigger value="gateway-logging" class="flex-none shrink-0 px-3"
            >日志</TabsTrigger
          >
          <TabsTrigger
            v-if="showTerminalTab"
            value="terminal"
            class="flex-none shrink-0 px-3"
            >终端</TabsTrigger
          >
          <TabsTrigger value="session" class="flex-none shrink-0 px-3"
            >会话</TabsTrigger
          >
          <TabsTrigger
            v-if="showPanelTab"
            value="panel"
            class="flex-none shrink-0 px-3"
            >面板</TabsTrigger
          >
          <TabsTrigger value="captcha" class="flex-none shrink-0 px-3"
            >Challenge</TabsTrigger
          >
          <TabsTrigger value="maintenance" class="flex-none shrink-0 px-3"
            >维护</TabsTrigger
          >
        </TabsList>
      </div>
      <TabsContent value="run-mode" class="pt-2">
        <RunModeSettings />
      </TabsContent>
      <TabsContent v-if="showTunnelTabs" value="frp" class="pt-2">
        <FrpSettings />
      </TabsContent>
      <TabsContent
        v-if="showTunnelTabs && showCloudflaredTab"
        value="cloudflared"
        class="pt-2"
      >
        <CloudflaredSettings />
      </TabsContent>
      <TabsContent value="acme-ssl" class="pt-2">
        <AcmeSSL />
      </TabsContent>
      <TabsContent value="ip-location" class="pt-2">
        <IpLocationSettings />
      </TabsContent>
      <TabsContent value="fnos" class="pt-2">
        <FnosSettings />
      </TabsContent>
      <TabsContent value="scanner-firewall" class="pt-2">
        <ScannerFirewallSettings />
      </TabsContent>
      <TabsContent value="features" class="pt-2">
        <FeaturesSettings />
      </TabsContent>
      <TabsContent value="gateway" class="pt-2">
        <GatewaySettings />
      </TabsContent>
      <TabsContent value="waf" class="pt-2">
        <WAFSettings />
      </TabsContent>
      <TabsContent value="gateway-logging" class="pt-2">
        <GatewayLoggingSettings />
      </TabsContent>
      <TabsContent v-if="showTerminalTab" value="terminal" class="pt-2">
        <TerminalSettings />
      </TabsContent>
      <TabsContent value="session" class="pt-2">
        <SessionSettings />
      </TabsContent>
      <TabsContent v-if="showPanelTab" value="panel" class="pt-2">
        <PanelSettings />
      </TabsContent>
      <TabsContent value="captcha" class="pt-2">
        <CaptchaSettings />
      </TabsContent>
      <TabsContent value="maintenance" class="pt-2">
        <MaintenanceSettings />
      </TabsContent>
    </Tabs>
  </div>
</template>
