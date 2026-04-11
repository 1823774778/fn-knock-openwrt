<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import RefreshButton from "@/components/RefreshButton.vue";
import { toast } from "@admin-shared/utils/toast";
import { SystemAPI } from "../../lib/api";
import type {
  SmartConnectConfig,
  SmartConnectDetails,
  SmartConnectLocalIpOption,
} from "../../types";
import {
  extractErrorMessage,
  useAsyncAction,
} from "@admin-shared/composables/useAsyncAction";
import { usePollingResourceStatus } from "@admin-shared/composables/usePollingResourceStatus";
import { useDelayedLoading } from "@admin-shared/composables/useDelayedLoading";
import { useConfigStore } from "../../store/config";

const router = useRouter();
const configStore = useConfigStore();
const details = ref<SmartConnectDetails | null>(null);
const loadError = ref("");
const form = reactive<SmartConnectConfig>({
  enabled: false,
  selected_ipv4: "",
});

const cloneDetails = (value: SmartConnectDetails): SmartConnectDetails => ({
  config: {
    ...value.config,
  },
  availability: {
    ...value.availability,
  },
  dnsmasq: {
    ...value.dnsmasq,
    install_state: {
      ...value.dnsmasq.install_state,
    },
    runtime: {
      ...value.dnsmasq.runtime,
      synced_domains: [...value.dnsmasq.runtime.synced_domains],
    },
  },
  domains: [...value.domains],
  local_ip_options: value.local_ip_options.map((item) => ({ ...item })),
});

const resolveSelectedIpv4 = (
  configuredValue: string,
  localIpOptions: SmartConnectLocalIpOption[],
): string => configuredValue.trim() || localIpOptions[0]?.value || "";

const normalizeSmartConnectConfig = (
  value: Partial<SmartConnectConfig>,
): SmartConnectConfig => ({
  enabled: value.enabled === true,
  selected_ipv4: String(value.selected_ipv4 ?? "").trim(),
});

const getComparableFormConfig = (
  value: Partial<SmartConnectConfig>,
  persistedSelectedIpv4 = "",
): SmartConnectConfig => {
  const normalized = normalizeSmartConnectConfig(value);
  if (normalized.enabled) {
    return normalized;
  }

  return {
    ...normalized,
    selected_ipv4: persistedSelectedIpv4.trim(),
  };
};

const hasUnsavedConfigDraft = (): boolean => {
  if (!details.value) return false;
  return (
    JSON.stringify(normalizeSmartConnectConfig(details.value.config)) !==
    JSON.stringify(
      getComparableFormConfig(form, details.value.config.selected_ipv4),
    )
  );
};

const applyDetails = (
  value: SmartConnectDetails,
  options: {
    preserveDraft?: boolean;
  } = {},
) => {
  const nextDetails = cloneDetails(value);
  const shouldPreserveDraft =
    options.preserveDraft === true && hasUnsavedConfigDraft();
  const selectedIpv4 = shouldPreserveDraft
    ? form.selected_ipv4
    : nextDetails.config.selected_ipv4;

  details.value = nextDetails;
  form.enabled = shouldPreserveDraft
    ? form.enabled
    : nextDetails.config.enabled;
  form.selected_ipv4 = resolveSelectedIpv4(
    selectedIpv4,
    nextDetails.local_ip_options,
  );
};

const { isPending: isSaving, run: runSave } = useAsyncAction({
  onError: (error) => {
    toast.error("保存失败", {
      description: extractErrorMessage(error, "智能连接保存失败"),
    });
    void refreshDetails();
  },
});

const { isPending: isStartingInstall, run: runStartInstall } = useAsyncAction({
  onError: (error) => {
    const installMode = details.value?.dnsmasq.installed
      ? "initialize"
      : "install";
    toast.error(installMode === "initialize" ? "初始化失败" : "安装失败", {
      description: extractErrorMessage(
        error,
        installMode === "initialize"
          ? "无法启动 dnsmasq 初始化"
          : "无法启动 dnsmasq 安装",
      ),
    });
    void refreshDetails();
  },
});

const { isInitializing, refresh: refreshDetails } =
  usePollingResourceStatus<SmartConnectDetails>({
    fetcher: async () => {
      const data = await SystemAPI.getSmartConnectDetails();
      return data;
    },
    onData: (value) => {
      loadError.value = "";
      applyDetails(value, { preserveDraft: true });
    },
    isDownloading: (value) =>
      value.dnsmasq.install_state.status === "installing",
    onError: (error) => {
      loadError.value = extractErrorMessage(error, "加载智能连接配置失败");
    },
  });

const showLoadingSkeleton = useDelayedLoading(isInitializing);

const isDirty = computed(() => {
  if (!details.value) return false;
  return (
    JSON.stringify(normalizeSmartConnectConfig(details.value.config)) !==
    JSON.stringify(
      getComparableFormConfig(form, details.value.config.selected_ipv4),
    )
  );
});

const capabilityBlockedReason = computed(() => {
  if (configStore.canUseSmartConnect) return "";
  if (configStore.isDockerDeployment) {
    return "Docker 部署暂不支持 Smart Connect，它依赖宿主机 dnsmasq、53 端口和网络行为。";
  }
  return "当前运行环境暂不支持 Smart Connect。";
});
const isSmartConnectAvailable = computed(
  () => details.value?.availability.available === true,
);
const showDnsmasqCard = computed(() => form.enabled);
const isDnsmasqReady = computed(() => {
  const dnsmasq = details.value?.dnsmasq;
  if (!dnsmasq) return false;

  return (
    dnsmasq.install_state.status !== "installing" &&
    dnsmasq.install_state.status !== "error" &&
    dnsmasq.installed &&
    dnsmasq.service_active &&
    dnsmasq.initialized
  );
});
const showDnsmasqSetupCard = computed(
  () => showDnsmasqCard.value && !isDnsmasqReady.value,
);
const showAdvancedCards = computed(() => form.enabled && isDnsmasqReady.value);
const dnsmasqSummaryText = computed(() => {
  const dnsmasq = details.value?.dnsmasq;
  if (!dnsmasq) return "";

  const parts = [
    dnsmasq.service_active ? "服务运行中" : "服务未运行",
    `管理 ${dnsmasq.runtime.managed_rule_count} 条规则`,
  ];
  return parts.join(" · ");
});
const dnsmasqProgress = computed(() => {
  const value = Number(details.value?.dnsmasq.install_state.progress ?? 0);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
});
const dnsmasqStatusLabel = computed(() => {
  const dnsmasq = details.value?.dnsmasq;
  if (!dnsmasq) return "加载中";
  if (dnsmasq.install_state.status === "installing") return "安装中";
  if (dnsmasq.install_state.status === "error") return "异常";
  if (!dnsmasq.installed) return "未安装";
  if (!dnsmasq.service_active) return "未运行";
  if (!dnsmasq.initialized) return "待初始化";
  return "已就绪";
});
const dnsmasqStatusVariant = computed(() => {
  const dnsmasq = details.value?.dnsmasq;
  if (!dnsmasq) return "outline";
  if (dnsmasq.install_state.status === "error") return "destructive";
  if (dnsmasq.install_state.status === "installing") return "secondary";
  if (!dnsmasq.installed) return "outline";
  if (!dnsmasq.service_active) return "destructive";
  if (!dnsmasq.initialized) return "secondary";
  return "default";
});
const dnsmasqNeedsInitialization = computed(() => {
  const dnsmasq = details.value?.dnsmasq;
  if (!dnsmasq?.installed) return false;
  return !dnsmasq.service_active || !dnsmasq.initialized;
});
const showDnsmasqAction = computed(() => {
  const dnsmasq = details.value?.dnsmasq;
  if (!dnsmasq) return false;
  return (
    dnsmasq.install_state.status === "installing" ||
    dnsmasq.install_state.status === "error" ||
    !dnsmasq.installed ||
    dnsmasqNeedsInitialization.value
  );
});
const dnsmasqActionLabel = computed(() => {
  return "初始化";
});
const resolvedIpOptions = computed<SmartConnectLocalIpOption[]>(() => {
  const currentOptions = details.value?.local_ip_options ?? [];
  if (
    !form.selected_ipv4 ||
    currentOptions.some((item) => item.value === form.selected_ipv4)
  ) {
    return currentOptions;
  }

  return [
    ...currentOptions,
    {
      label: `${form.selected_ipv4} (当前配置，暂未检测到)`,
      value: form.selected_ipv4,
      interface: "manual",
    },
  ];
});
const saveBlockedReason = computed(() => {
  if (!configStore.canUseSmartConnect) {
    return capabilityBlockedReason.value;
  }
  if (!form.enabled) return "";
  if (!isSmartConnectAvailable.value) {
    return details.value?.availability.reason || "当前模式暂不可用";
  }
  if (!details.value?.dnsmasq.initialized) {
    return "请先完成 dnsmasq 环境初始化";
  }
  if (!form.selected_ipv4) {
    return "请选择本机局域网 IP";
  }
  if ((details.value?.domains.length ?? 0) === 0) {
    return "当前没有可同步的子域映射";
  }
  return "";
});

const refreshAll = async () => {
  await Promise.all([refreshDetails(), configStore.loadConfig()]);
};

const startDnsmasqInstall = async () => {
  if (isStartingInstall.value) {
    return;
  }

  const installMode = details.value?.dnsmasq.installed
    ? "initialize"
    : "install";
  await runStartInstall(() => SystemAPI.installDnsmasq(), {
    onSuccess: async (state) => {
      toast.success(
        state.status === "installed"
          ? installMode === "initialize"
            ? "dnsmasq 已初始化"
            : "dnsmasq 已就绪"
          : installMode === "initialize"
            ? "已开始初始化 dnsmasq"
            : "已开始安装 dnsmasq",
      );
      await refreshDetails();
    },
  });
};

const cancelAndBack = () => {
  void router.push({
    path: "/system",
    query: {
      tab: "features",
    },
  });
};

const saveSettings = async () => {
  if (saveBlockedReason.value) {
    toast.error("暂时无法保存", {
      description: saveBlockedReason.value,
    });
    return;
  }

  await runSave(
    () =>
      SystemAPI.updateSmartConnect({
        enabled: form.enabled,
        selected_ipv4: form.enabled ? form.selected_ipv4 : undefined,
      }),
    {
      onSuccess: async (value) => {
        applyDetails(value);
        await configStore.loadConfig();
        toast.success("智能连接已更新并完成同步");
      },
    },
  );
};
</script>

<template>
  <div class="space-y-5">
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#/system">系统设置</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#/system?tab=features">功能</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>智能连接</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <Card class="border-border/50 shadow-none">
      <CardHeader class="space-y-4">
        <div
          class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
        >
          <div class="space-y-1.5">
            <div class="flex flex-wrap items-center gap-2">
              <CardTitle class="text-xl tracking-tight">智能连接</CardTitle>
            </div>
            <CardDescription class="max-w-2xl leading-6">
              回到局域网后，让子域直接回到本机 IP，减少继续绕公网访问。
            </CardDescription>
          </div>
          <RefreshButton
            :loading="isInitializing"
            :disabled="isSaving || isStartingInstall"
            @click="refreshAll"
          />
        </div>
      </CardHeader>

      <CardContent class="space-y-5">
        <div
          v-if="!details && isInitializing && showLoadingSkeleton"
          class="space-y-4"
        >
          <Skeleton class="h-28 w-full rounded-2xl" />
          <Skeleton class="h-56 w-full rounded-2xl" />
        </div>

        <div
          v-else-if="loadError && !details"
          class="rounded-xl border border-destructive/25 bg-destructive/5 px-5 py-4 text-sm text-destructive"
        >
          {{ loadError }}
        </div>

        <template v-else-if="details">
          <div
            v-if="!isSmartConnectAvailable || !configStore.canUseSmartConnect"
            class="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700"
          >
            {{
              !configStore.canUseSmartConnect
                ? capabilityBlockedReason
                : `当前模式暂不可用。${details.availability.reason}`
            }}
          </div>

          <div
            class="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0 space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <Label class="text-base font-medium">智能连接</Label>
                </div>
              </div>

              <Switch
                class="mt-0.5 shrink-0"
                :model-value="form.enabled"
                :disabled="
                  !configStore.canUseSmartConnect ||
                  isSaving ||
                  isStartingInstall
                "
                @update:model-value="form.enabled = $event === true"
              />
            </div>
          </div>

          <div class="overflow-hidden rounded-xl border border-border/60">
            <template v-if="showDnsmasqCard">
              <section v-if="showDnsmasqSetupCard" class="space-y-4 p-5">
                <div
                  class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div class="space-y-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <Label class="text-base">运行环境</Label>
                      <Badge :variant="dnsmasqStatusVariant">
                        {{ dnsmasqStatusLabel }}
                      </Badge>
                    </div>
                    <p class="text-sm leading-6 text-muted-foreground">
                      {{ details.dnsmasq.install_state.message }}
                    </p>
                    <p class="text-xs leading-5 text-muted-foreground">
                      {{ dnsmasqSummaryText }}
                    </p>
                  </div>

                  <Button
                    v-if="showDnsmasqAction"
                    class="w-full sm:w-auto"
                    :disabled="
                      isSaving ||
                      isStartingInstall ||
                      details.dnsmasq.install_state.status === 'installing'
                    "
                    @click="startDnsmasqInstall"
                  >
                    <span
                      v-if="
                        isStartingInstall ||
                        details.dnsmasq.install_state.status === 'installing'
                      "
                      class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-foreground"
                    ></span>
                    {{ dnsmasqActionLabel }}
                  </Button>
                </div>

                <div
                  v-if="details.dnsmasq.install_state.status === 'installing'"
                >
                  <Progress :model-value="dnsmasqProgress" />
                </div>
              </section>

              <template v-if="showAdvancedCards">
                <section
                  :class="[
                    'space-y-4 p-5',
                    showDnsmasqSetupCard ? 'border-t border-border/60' : '',
                  ]"
                >
                  <div
                    class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start lg:gap-6"
                  >
                    <div class="space-y-1">
                      <Label class="text-base">本机局域网 IP</Label>
                      <p class="text-sm leading-6 text-muted-foreground">
                        选择客户端回到局域网后应访问的本机地址。
                      </p>
                    </div>

                    <div class="space-y-2">
                      <Select
                        :model-value="form.selected_ipv4 || undefined"
                        @update:model-value="
                          form.selected_ipv4 = String($event ?? '')
                        "
                      >
                        <SelectTrigger
                          class="h-10 w-full rounded-lg border-border/70 bg-background px-3 text-sm shadow-none"
                        >
                          <SelectValue placeholder="选择一个局域网 IPv4 地址" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            v-for="option in resolvedIpOptions"
                            :key="`${option.interface}-${option.value}`"
                            :value="option.value"
                          >
                            {{ option.label }}
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      <p
                        v-if="resolvedIpOptions.length === 0"
                        class="text-sm leading-6 text-muted-foreground"
                      >
                        当前未检测到合适的私网 IPv4
                        地址，请检查网卡状态后刷新页面。
                      </p>
                    </div>
                  </div>
                </section>

                <section class="space-y-4 border-t border-border/60 p-5">
                  <div class="space-y-1">
                    <Label class="text-base">同步的子域</Label>
                    <p class="text-sm leading-6 text-muted-foreground">
                      会自动跟随子域变化同步，无需单独维护。
                    </p>
                  </div>

                  <div class="rounded-xl bg-muted/20 px-4 py-4">
                    <div
                      v-if="details.domains.length === 0"
                      class="text-sm leading-6 text-muted-foreground"
                    >
                      当前还没有可同步的子域映射，请先到“子域代理”里添加。
                    </div>
                    <div v-else class="flex flex-wrap gap-2">
                      <Badge
                        v-for="domain in details.domains"
                        :key="domain"
                        variant="secondary"
                        class="max-w-full break-all"
                      >
                        {{ domain }}
                      </Badge>
                    </div>
                  </div>
                </section>

                <section class="space-y-4 border-t border-border/60 p-5">
                  <div class="space-y-1">
                    <Label class="text-base">说明</Label>
                    <p class="text-sm leading-6 text-muted-foreground">
                      要让设备真正生效，请修改路由器DHCP服务器的DNS服务器为
                      {{
                        form.selected_ipv4 || "本机的局域网IP"
                      }}，或者在设备上手动设置 DNS 服务器为
                      {{
                        form.selected_ipv4 || "本机的局域网IP"
                      }}。配置好后请重新连接Wi-Fi

                      <span
                        >注意：Android版的飞牛App客户端可能存在兼容问题，如遇到无法登录的问题，请关闭此功能</span
                      >
                    </p>
                  </div>
                </section>
              </template>
            </template>

            <section
              :class="[
                'space-y-4 p-5',
                showDnsmasqCard ? 'border-t border-border/60' : '',
              ]"
            >
              <div
                class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <p class="text-sm leading-6 text-muted-foreground">
                  {{ saveBlockedReason || "保存后会立即同步配置。" }}
                </p>

                <div class="flex gap-3 sm:ml-auto">
                  <Button
                    variant="outline"
                    :disabled="isSaving"
                    @click="cancelAndBack"
                  >
                    取消
                  </Button>
                  <Button
                    :disabled="
                      !isDirty ||
                      isSaving ||
                      isStartingInstall ||
                      Boolean(saveBlockedReason)
                    "
                    @click="saveSettings"
                  >
                    <span
                      v-if="isSaving"
                      class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-foreground"
                    ></span>
                    {{ isSaving ? "保存中..." : "保存并同步" }}
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </template>
      </CardContent>
    </Card>
  </div>
</template>
