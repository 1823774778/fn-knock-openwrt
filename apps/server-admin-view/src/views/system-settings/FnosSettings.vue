<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@admin-shared/utils/toast";
import { SystemAPI } from "../../lib/api";
import type {
  FnosPortIconHijackConfig,
  FnosShareBypassConfig,
} from "../../types";
import {
  extractErrorMessage,
  useAsyncAction,
} from "@admin-shared/composables/useAsyncAction";
import { useDelayedLoading } from "@admin-shared/composables/useDelayedLoading";
import { useConfigStore } from "../../store/config";

const configStore = useConfigStore();
const DEFAULT_FNOS_SHARE_BYPASS_VALUES = {
  upstream_timeout_ms: 2500,
  validation_cache_ttl_seconds: 30,
  validation_lock_ttl_seconds: 5,
  session_ttl_seconds: 300,
} satisfies Omit<FnosShareBypassConfig, "enabled">;
const settings = ref<FnosShareBypassConfig | null>(null);
const form = reactive<FnosShareBypassConfig>({
  enabled: false,
  ...DEFAULT_FNOS_SHARE_BYPASS_VALUES,
});
const iconHijackSettings = ref<FnosPortIconHijackConfig | null>(null);
const iconHijackForm = reactive<FnosPortIconHijackConfig>({
  enabled: false,
  updated_at: null,
});

const { isPending: isLoading, run: runLoadSettings } = useAsyncAction({
  onError: (error) => {
    toast.error("加载失败", {
      description: extractErrorMessage(error, "无法获取飞牛设置"),
    });
  },
});
const showLoadingSkeleton = useDelayedLoading(isLoading);
const { isPending: isSaving, run: runSaveSettings } = useAsyncAction({
  onError: (error) => {
    toast.error("保存失败", {
      description: extractErrorMessage(error, "保存飞牛设置失败"),
    });
  },
});
const { isPending: isIconHijackSaving, run: runSaveIconHijackSettings } =
  useAsyncAction({
    onError: (error) => {
      toast.error("保存失败", {
        description: extractErrorMessage(error, "保存飞牛端口图标接管设置失败"),
      });
    },
  });
const isShareBypassMode = computed(
  () =>
    configStore.config?.run_type === 1 || configStore.config?.run_type === 3,
);
const isRestrictedByRunMode = computed(
  () => configStore.config?.run_type === 0,
);

const applyFromSettings = (data: FnosShareBypassConfig) => {
  settings.value = data;
  form.enabled = data.enabled;
  form.upstream_timeout_ms = data.upstream_timeout_ms;
  form.validation_cache_ttl_seconds = data.validation_cache_ttl_seconds;
  form.validation_lock_ttl_seconds = data.validation_lock_ttl_seconds;
  form.session_ttl_seconds = data.session_ttl_seconds;
};

const applyIconHijackFromSettings = (data: FnosPortIconHijackConfig) => {
  iconHijackSettings.value = data;
  iconHijackForm.enabled = data.enabled;
  iconHijackForm.updated_at = data.updated_at;
};

const fetchSettings = async () => {
  await runLoadSettings(async () => {
    const [shareBypass, iconHijack] = await Promise.all([
      SystemAPI.getFnosShareBypassConfig(),
      SystemAPI.getFnosPortIconHijackConfig(),
    ]);
    applyFromSettings(shareBypass);
    applyIconHijackFromSettings(iconHijack);
  });
};

const saveShareBypassEnabled = async (nextValue: boolean) => {
  if (!isShareBypassMode.value || isSaving.value) {
    if (!isShareBypassMode.value) {
      toast.error("当前运行模式不可用", {
        description:
          "此功能仅在反代模式和子域模式下可用。直连模式下，需要完成鉴权后才能开启对应端口供其他人访问。",
      });
    }
    return;
  }

  const previousSettings = settings.value;
  form.enabled = nextValue;

  const result = await runSaveSettings(
    () =>
      SystemAPI.updateFnosShareBypassConfig({
        enabled: nextValue,
        ...DEFAULT_FNOS_SHARE_BYPASS_VALUES,
      }),
    {
      onSuccess: (data) => {
        applyFromSettings(data);
        toast.success("飞牛分享直通设置已更新");
      },
    },
  );

  if (!result && previousSettings) {
    applyFromSettings(previousSettings);
  }
};

const saveIconHijackEnabled = async (nextValue: boolean) => {
  if (isIconHijackSaving.value) {
    return;
  }

  const previousSettings = iconHijackSettings.value;
  iconHijackForm.enabled = nextValue;

  const result = await runSaveIconHijackSettings(
    () =>
      SystemAPI.updateFnosPortIconHijackConfig({
        enabled: nextValue,
      }),
    {
      onSuccess: (data) => {
        applyIconHijackFromSettings(data);
        toast.success("飞牛端口图标接管设置已更新");
      },
    },
  );

  if (!result && previousSettings) {
    applyIconHijackFromSettings(previousSettings);
  }
};

const toggleShareBypass = () => {
  void saveShareBypassEnabled(!form.enabled);
};

const toggleIconHijack = () => {
  void saveIconHijackEnabled(!iconHijackForm.enabled);
};

onMounted(fetchSettings);
</script>

<template>
  <Card>
    <CardContent v-if="isLoading && showLoadingSkeleton" class="p-0">
      <div class="space-y-4 p-6">
        <Skeleton class="h-6 w-1/3" />
        <Skeleton class="h-4 w-2/3" />
        <Skeleton class="h-6 w-1/3" />
        <Skeleton class="h-4 w-2/3" />
      </div>
    </CardContent>

    <CardContent v-else-if="!isLoading" class="p-0 divide-y">
      <div class="flex items-center justify-between bg-muted/10 p-6">
        <div class="space-y-1 pr-6">
          <Label
            class="text-base font-medium"
            :class="
              isShareBypassMode
                ? 'cursor-pointer'
                : 'cursor-not-allowed text-zinc-500'
            "
            @click="toggleShareBypass"
          >
            飞牛分享直通
          </Label>
          <div
            class="text-sm"
            :class="
              isShareBypassMode ? 'text-muted-foreground' : 'text-zinc-500'
            "
          >
            开启后，分享链接可按飞牛校验结果直通访问；反代模式和子域模式可用。
          </div>
          <div
            v-if="isRestrictedByRunMode"
            class="text-xs leading-5 text-zinc-500"
          >
            当前为直连模式，此功能暂不可用。
          </div>
        </div>
        <Switch
          :model-value="isShareBypassMode ? form.enabled : false"
          :disabled="!isShareBypassMode || isSaving"
          @update:model-value="saveShareBypassEnabled($event === true)"
        />
      </div>

      <div class="flex items-center justify-between bg-muted/10 p-6">
        <div class="space-y-1 pr-6">
          <Label
            class="cursor-pointer text-base font-medium"
            @click="toggleIconHijack"
          >
            端口类图标接管
          </Label>
          <div class="text-sm text-muted-foreground">
            公网访问时，飞牛桌面里有些应用图标会跳到不可访问的本机端口。开启后，点击这些原本指向端口的图标，会自动<u>匹配已有的子域映射</u>并改为可访问地址。你也可以手动每个图标进行编辑“自定义URL”来实现，但通过这里可以一键完成。
          </div>
        </div>
        <Switch
          :model-value="iconHijackForm.enabled"
          :disabled="isIconHijackSaving"
          @update:model-value="saveIconHijackEnabled($event === true)"
        />
      </div>
    </CardContent>

    <CardContent v-else class="min-h-[160px]" aria-hidden="true" />
  </Card>
</template>
