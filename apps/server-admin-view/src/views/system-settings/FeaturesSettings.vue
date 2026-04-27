<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ChevronRight } from "lucide-vue-next";
import { toast } from "@admin-shared/utils/toast";
import { ConfigAPI, SSHSecurityAPI, SystemAPI } from "../../lib/api";
import type {
  AuthCredentialSettings,
  AutoHttpsDetails,
  DashboardDisplayConfig,
  ProtocolMappingFeatureConfig,
} from "../../types";
import {
  extractErrorMessage,
  useAsyncAction,
} from "@admin-shared/composables/useAsyncAction";
import { useDelayedLoading } from "@admin-shared/composables/useDelayedLoading";
import { useConfigStore } from "../../store/config";

const router = useRouter();
const configStore = useConfigStore();
const protocolMappingEnabled = ref(false);
const passkeyBindPromptEnabled = ref(true);
const showEntryStatusModule = ref(true);
const autoHttpsDetails = ref<AutoHttpsDetails | null>(null);
const sshSecurityEnabled = ref(false);
const sshSecurityUnavailableReason = ref("");
const runTypeLabelMap = {
  0: "直连模式",
  1: "反代模式",
  3: "子域模式",
} as const;

const { isPending: isLoading, run: runLoadSettings } = useAsyncAction({
  onError: (error) => {
    toast.error("加载失败", {
      description: extractErrorMessage(error, "无法获取功能设置"),
    });
  },
});
const showLoadingSkeleton = useDelayedLoading(isLoading);
const { isPending: isSaving, run: runSaveSettings } = useAsyncAction({
  onError: (error) => {
    toast.error("更新失败", {
      description: extractErrorMessage(error, "功能设置更新失败"),
    });
  },
});
const isProtocolMappingAvailable = computed(
  () => configStore.config?.run_type === 3,
);
const isSmartConnectAvailable = computed(
  () => configStore.canUseSmartConnect && configStore.config?.run_type === 3,
);
const showSmartConnectEntry = computed(() => !configStore.isDockerDeployment);
const isDashboardDisplaySwitchDisabled = computed(
  () => isSaving.value || configStore.isLoading || configStore.isError,
);
const currentRunTypeLabel = computed(() => {
  const runType = configStore.config?.run_type;
  if (runType === 0 || runType === 1 || runType === 3) {
    return runTypeLabelMap[runType];
  }
  return "当前模式";
});
const protocolMappingDisabledReason = computed(() => {
  if (isProtocolMappingAvailable.value) return "";
  return `仅子域模式可开启，当前为${currentRunTypeLabel.value}。`;
});
const smartConnectDisabledReason = computed(() => {
  if (isSmartConnectAvailable.value) return "";
  if (!configStore.canUseSmartConnect) {
    return configStore.isDockerDeployment
      ? "Docker 部署暂不支持 Smart Connect，它依赖宿主机 dnsmasq 与 53 端口。"
      : "当前运行环境暂不支持 Smart Connect。";
  }
  return `仅子域模式可用，当前为${currentRunTypeLabel.value}。`;
});
const autoHttpsEnabled = computed(
  () => autoHttpsDetails.value?.enabled === true,
);
const autoHttpsRuntimeError = computed(() => {
  const runtime = autoHttpsDetails.value?.runtime;
  if (runtime?.status !== "error") return "";
  return runtime.last_error || "自动 HTTPS 未能监听 80 端口";
});
const showAutoHttpsEntry = computed(() => !configStore.isDockerDeployment);
const showSSHSecurityEntry = computed(() => !configStore.isDockerDeployment);
const isSSHSecurityAvailable = computed(
  () =>
    configStore.canManageHostFirewall && !sshSecurityUnavailableReason.value,
);
const sshSecurityDisabledReason = computed(() => {
  if (isSSHSecurityAvailable.value) return "";
  return (
    sshSecurityUnavailableReason.value ||
    "当前运行环境暂不支持宿主机 SSH 防火墙管理。"
  );
});

const applyProtocolMappingSettings = (data: ProtocolMappingFeatureConfig) => {
  protocolMappingEnabled.value = data.enabled;
};

const applyAutoHttpsDetails = (data: AutoHttpsDetails) => {
  autoHttpsDetails.value = data;
};

const applySSHSecurityDetails = (
  data: Awaited<ReturnType<typeof SSHSecurityAPI.getDetails>>,
) => {
  sshSecurityEnabled.value = data.config.enabled;
  sshSecurityUnavailableReason.value = data.summary.available
    ? ""
    : data.summary.unavailable_reason;
};

const applyAuthCredentialSettings = (data: AuthCredentialSettings) => {
  passkeyBindPromptEnabled.value = data.passkey_bind_prompt_enabled !== false;
};

const applyDashboardDisplaySettings = (data: DashboardDisplayConfig) => {
  showEntryStatusModule.value = data.show_entry_status_module;
};

const syncDashboardDisplayFromConfig = () => {
  if (!configStore.config) {
    return;
  }

  applyDashboardDisplaySettings({
    show_entry_status_module:
      configStore.config.dashboard_display?.show_entry_status_module !== false,
  });
};

const fetchSettings = async () => {
  await runLoadSettings(async () => {
    const [protocolMappingSettings, authCredentialSettings] = await Promise.all(
      [
        SystemAPI.getProtocolMappingFeatureConfig(),
        ConfigAPI.getAuthCredentialSettings(),
      ],
    );
    applyProtocolMappingSettings(protocolMappingSettings);
    applyAuthCredentialSettings(authCredentialSettings);

    if (showAutoHttpsEntry.value) {
      applyAutoHttpsDetails(await SystemAPI.getAutoHttpsDetails());
    } else {
      autoHttpsDetails.value = null;
    }

    if (showSSHSecurityEntry.value) {
      applySSHSecurityDetails(await SSHSecurityAPI.getDetails());
    } else {
      sshSecurityEnabled.value = false;
      sshSecurityUnavailableReason.value = "";
    }
  });
};

const saveProtocolMappingEnabled = async (nextValue: boolean) => {
  if (!isProtocolMappingAvailable.value || isSaving.value) {
    return;
  }

  const previousValue = protocolMappingEnabled.value;
  protocolMappingEnabled.value = nextValue;

  const result = await runSaveSettings(
    () =>
      SystemAPI.updateProtocolMappingFeatureConfig({
        enabled: nextValue,
      }),
    {
      onSuccess: async (data) => {
        applyProtocolMappingSettings(data);
        toast.success("功能设置已更新");
        await configStore.loadConfig();
      },
    },
  );

  if (!result) {
    protocolMappingEnabled.value = previousValue;
  }
};

const saveShowEntryStatusModule = async (nextValue: boolean) => {
  if (isDashboardDisplaySwitchDisabled.value || !configStore.config) {
    return;
  }

  const previousValue = showEntryStatusModule.value;
  showEntryStatusModule.value = nextValue;

  const result = await runSaveSettings(
    () =>
      ConfigAPI.updateDashboardDisplayConfig({
        show_entry_status_module: nextValue,
      }),
    {
      onSuccess: async (data) => {
        applyDashboardDisplaySettings(data);
        toast.success("功能设置已更新");
        await configStore.loadConfig();
      },
    },
  );

  if (!result) {
    showEntryStatusModule.value = previousValue;
  }
};

const savePasskeyBindPromptEnabled = async (nextValue: boolean) => {
  if (isSaving.value) {
    return;
  }

  const previousValue = passkeyBindPromptEnabled.value;
  passkeyBindPromptEnabled.value = nextValue;

  const result = await runSaveSettings(
    () =>
      ConfigAPI.updateAuthCredentialSettings({
        passkey_bind_prompt_enabled: nextValue,
      }),
    {
      onSuccess: async (data) => {
        applyAuthCredentialSettings(data);
        toast.success("功能设置已更新");
        await configStore.loadConfig();
      },
    },
  );

  if (!result) {
    passkeyBindPromptEnabled.value = previousValue;
  }
};

const saveAutoHttpsEnabled = async (nextValue: boolean) => {
  if (isSaving.value) {
    return;
  }

  const previousValue = autoHttpsDetails.value;
  autoHttpsDetails.value = {
    enabled: nextValue,
    runtime: previousValue?.runtime ?? {
      enabled: false,
      active: false,
      status: "disabled",
      listen_host: "::",
      listen_port: 80,
      redirect_scheme: "https",
      last_error: null,
      last_error_at: null,
      updated_at: new Date().toISOString(),
    },
  };

  const result = await runSaveSettings(
    () =>
      SystemAPI.updateAutoHttps({
        enabled: nextValue,
      }),
    {
      onSuccess: async (data) => {
        applyAutoHttpsDetails(data);
        if (data.runtime.status === "error") {
          toast.error("自动 HTTPS 启动失败", {
            description:
              data.runtime.last_error ||
              "80 端口无法监听，请检查权限或占用情况",
          });
        } else {
          toast.success("功能设置已更新");
        }
        await configStore.loadConfig();
      },
    },
  );

  if (!result) {
    autoHttpsDetails.value = previousValue;
  }
};

const saveSSHSecurityEnabled = async (nextValue: boolean) => {
  if (isSaving.value || (!isSSHSecurityAvailable.value && nextValue)) {
    return;
  }

  const previousValue = sshSecurityEnabled.value;
  sshSecurityEnabled.value = nextValue;

  const result = await runSaveSettings(
    () =>
      SSHSecurityAPI.updateConfig({
        enabled: nextValue,
      }),
    {
      onSuccess: async (data) => {
        applySSHSecurityDetails(data);
        toast.success("功能设置已更新");
        await configStore.loadConfig();
      },
    },
  );

  if (!result) {
    sshSecurityEnabled.value = previousValue;
  }
};

const openSmartConnect = () => {
  if (!isSmartConnectAvailable.value) {
    return;
  }

  void router.push("/system/smart-connect");
};

onMounted(() => {
  syncDashboardDisplayFromConfig();
  void fetchSettings();
});

watch(
  () => configStore.config?.dashboard_display?.show_entry_status_module,
  () => {
    syncDashboardDisplayFromConfig();
  },
  { immediate: true },
);

watch(
  () => configStore.config?.run_type,
  (runType) => {
    if (runType === 3) {
      void fetchSettings();
      return;
    }

    protocolMappingEnabled.value = false;
  },
);
</script>

<template>
  <Card>
    <CardHeader>
      <div class="space-y-1.5">
        <CardTitle class="text-md">功能开关</CardTitle>
        <CardDescription>控制可选功能的启用状态。</CardDescription>
      </div>
    </CardHeader>

    <CardContent v-if="isLoading && showLoadingSkeleton" class="border-t p-0">
      <div class="space-y-4 p-6">
        <Skeleton class="h-6 w-1/3" />
        <Skeleton class="h-4 w-2/3" />
      </div>
    </CardContent>

    <CardContent v-else-if="!isLoading" class="border-t p-0 divide-y">
      <div class="flex items-center justify-between bg-muted/10 p-6">
        <div class="space-y-1 pr-6">
          <Label
            class="cursor-pointer text-base font-medium"
            @click="saveShowEntryStatusModule(!showEntryStatusModule)"
          >
            在首页显示入口状态模块
          </Label>
          <div class="text-sm text-muted-foreground">
            关闭后，首页的“入口状态”卡片将隐藏
          </div>
        </div>
        <Switch
          :model-value="showEntryStatusModule"
          :disabled="isDashboardDisplaySwitchDisabled"
          @update:model-value="saveShowEntryStatusModule($event === true)"
        />
      </div>

      <div class="flex items-center justify-between bg-muted/10 p-6">
        <div class="space-y-1 pr-6">
          <Label
            class="cursor-pointer text-base font-medium"
            @click="savePasskeyBindPromptEnabled(!passkeyBindPromptEnabled)"
          >
            登录后提示绑定 Passkey
          </Label>
          <div class="text-sm text-muted-foreground">
            关闭后，AUTH 登录成功后将不再弹出 Passkey 绑定提示
          </div>
        </div>
        <Switch
          :model-value="passkeyBindPromptEnabled"
          :disabled="isSaving"
          @update:model-value="savePasskeyBindPromptEnabled($event === true)"
        />
      </div>

      <div
        v-if="showAutoHttpsEntry"
        class="flex items-center justify-between bg-muted/10 p-6"
      >
        <div class="space-y-1 pr-6">
          <Label
            class="cursor-pointer text-base font-medium"
            :class="autoHttpsRuntimeError ? 'text-red-600' : ''"
            @click="saveAutoHttpsEnabled(!autoHttpsEnabled)"
          >
            自动HTTPS
          </Label>
          <div
            class="text-sm"
            :class="
              autoHttpsRuntimeError ? 'text-red-600' : 'text-muted-foreground'
            "
          >
            如果80，443没有被运营商封锁，应用设置，Go 代理端口
            (GO_REPROXY_PORT)可改为443，然后开启此开关即可自动跳HTTPS
          </div>
          <div
            v-if="autoHttpsRuntimeError"
            class="text-xs leading-5 text-red-600"
          >
            {{ autoHttpsRuntimeError }}
          </div>
        </div>
        <Switch
          :model-value="autoHttpsEnabled"
          :disabled="isSaving"
          @update:model-value="saveAutoHttpsEnabled($event === true)"
        />
      </div>

      <div
        v-if="showSSHSecurityEntry"
        class="flex items-center justify-between bg-muted/10 p-6"
      >
        <div class="space-y-1 pr-6">
          <Label
            class="text-base font-medium"
            :class="
              isSSHSecurityAvailable
                ? 'cursor-pointer'
                : 'cursor-not-allowed text-zinc-500'
            "
            @click="saveSSHSecurityEnabled(!sshSecurityEnabled)"
          >
            SSH安全
          </Label>
          <div
            class="text-sm"
            :class="
              isSSHSecurityAvailable ? 'text-muted-foreground' : 'text-zinc-500'
            "
          >
            开启后显示“SSH安全”入口，并根据 SSH 登录日志自动封锁异常来源
          </div>
          <div
            v-if="!isSSHSecurityAvailable"
            class="text-xs leading-5 text-zinc-500"
          >
            {{ sshSecurityDisabledReason }}
          </div>
        </div>
        <Switch
          :model-value="isSSHSecurityAvailable ? sshSecurityEnabled : false"
          :disabled="!isSSHSecurityAvailable || isSaving"
          @update:model-value="saveSSHSecurityEnabled($event === true)"
        />
      </div>

      <div class="flex items-center justify-between bg-muted/10 p-6">
        <div class="space-y-1 pr-6">
          <Label
            class="text-base font-medium"
            :class="
              isProtocolMappingAvailable
                ? 'cursor-pointer'
                : 'cursor-not-allowed text-zinc-500'
            "
            @click="saveProtocolMappingEnabled(!protocolMappingEnabled)"
          >
            协议映射
          </Label>
          <div
            class="text-sm"
            :class="
              isProtocolMappingAvailable
                ? 'text-muted-foreground'
                : 'text-zinc-500'
            "
          >
            开启后，显示“协议映射”入口并启用 TCP/UDP 转发
          </div>
          <div
            v-if="!isProtocolMappingAvailable"
            class="text-xs leading-5 text-zinc-500"
          >
            {{ protocolMappingDisabledReason }}
          </div>
        </div>
        <Switch
          :model-value="
            isProtocolMappingAvailable ? protocolMappingEnabled : false
          "
          :disabled="!isProtocolMappingAvailable || isSaving"
          @update:model-value="saveProtocolMappingEnabled($event === true)"
        />
      </div>

      <button
        v-if="showSmartConnectEntry"
        type="button"
        class="flex w-full items-center justify-between p-6 text-left transition-colors"
        :class="
          isSmartConnectAvailable
            ? 'bg-muted/5 hover:bg-muted/15'
            : 'cursor-not-allowed bg-muted/5'
        "
        :disabled="!isSmartConnectAvailable"
        @click="openSmartConnect"
      >
        <div class="space-y-1 pr-6">
          <div
            class="text-base font-medium"
            :class="
              isSmartConnectAvailable ? 'text-foreground' : 'text-zinc-500'
            "
          >
            智能连接
          </div>
          <div
            class="text-sm"
            :class="
              isSmartConnectAvailable
                ? 'text-muted-foreground'
                : 'text-zinc-500'
            "
          >
            根据网络环境自动选择局域网或公网访问
          </div>
          <div
            v-if="!isSmartConnectAvailable"
            class="text-xs leading-5 text-zinc-500"
          >
            {{ smartConnectDisabledReason }}
          </div>
        </div>
        <ChevronRight
          class="h-5 w-5 shrink-0"
          :class="
            isSmartConnectAvailable ? 'text-muted-foreground' : 'text-zinc-400'
          "
        />
      </button>
    </CardContent>
  </Card>
</template>
