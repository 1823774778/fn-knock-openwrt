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
import { SystemAPI } from "../../lib/api";
import type { ProtocolMappingFeatureConfig } from "../../types";
import {
  extractErrorMessage,
  useAsyncAction,
} from "@admin-shared/composables/useAsyncAction";
import { useDelayedLoading } from "@admin-shared/composables/useDelayedLoading";
import { useConfigStore } from "../../store/config";

const router = useRouter();
const configStore = useConfigStore();
const settings = ref<ProtocolMappingFeatureConfig | null>(null);
const protocolMappingEnabled = ref(false);
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
const isSmartConnectAvailable = isProtocolMappingAvailable;
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
  return `仅子域模式可用，当前为${currentRunTypeLabel.value}。`;
});

const applyFromSettings = (data: ProtocolMappingFeatureConfig) => {
  settings.value = data;
  protocolMappingEnabled.value = data.enabled;
};

const fetchSettings = async () => {
  await runLoadSettings(async () => {
    const data = await SystemAPI.getProtocolMappingFeatureConfig();
    applyFromSettings(data);
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
        applyFromSettings(data);
        toast.success("功能设置已更新");
        await configStore.loadConfig();
      },
    },
  );

  if (!result) {
    protocolMappingEnabled.value = previousValue;
  }
};

const openSmartConnect = () => {
  if (!isSmartConnectAvailable.value) {
    return;
  }

  void router.push("/system/smart-connect");
};

onMounted(fetchSettings);

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
