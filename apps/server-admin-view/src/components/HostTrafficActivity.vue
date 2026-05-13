<template>
  <Popover :open="open" @update:open="handleOpenChange">
    <PopoverAnchor as-child>
      <button
        type="button"
        class="inline-flex min-h-6 max-w-full flex-wrap items-center gap-x-2 gap-y-1 px-1.5 text-left text-xs leading-none transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="{ 'border-primary/30 bg-primary/5': open || dialogOpen }"
        :aria-label="`${displayTitle} ${host} 流量详情`"
        @pointerdown="handleTriggerPointerDown"
        @pointerenter="handleTriggerPointerEnter"
        @pointerleave="handleTriggerPointerLeave"
        @focus="handleTriggerFocus"
        @blur="handleTriggerBlur"
        @click.prevent="handleTriggerClick"
      >
        <span
          v-if="hasRealtimeInTraffic"
          class="inline-flex items-center gap-1"
        >
          <ArrowDownLeft class="h-3 w-3 shrink-0 text-emerald-700" />
          <span>{{ compactInText }}</span>
        </span>
        <span
          v-if="hasRealtimeOutTraffic"
          class="inline-flex items-center gap-1"
        >
          <ArrowUpRight class="h-3 w-3 shrink-0 text-blue-700" />
          <span>{{ compactOutText }}</span>
        </span>
        <span v-if="!hasCompactTraffic">查看</span>
      </button>
    </PopoverAnchor>

    <PopoverContent
      v-if="!isTouchInteraction"
      side="left"
      align="center"
      class="w-[28rem] max-w-[92vw] rounded-md p-0 text-left"
      @pointerenter="handleContentPointerEnter"
      @pointerleave="handleContentPointerLeave"
    >
      <div class="border-b px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="truncate text-sm font-semibold" :title="displayTitle">
              {{ displayTitle }}
            </div>
            <div
              class="mt-1 break-all text-xs font-medium text-muted-foreground"
              :title="host"
            >
              {{ host }}
            </div>
            <div class="mt-1 text-xs text-muted-foreground">
              {{ sampleStatusText }}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="h-7 shrink-0 px-2 text-xs"
            @click.stop.prevent="openActiveIpDialog"
          >
            <Network class="h-3.5 w-3.5" />
            {{ activeIpButtonText }}
          </Button>
        </div>
      </div>

      <div class="space-y-4 p-4">
        <div class="grid gap-2 sm:grid-cols-2">
          <div class="rounded-md border bg-muted/20 px-3 py-2.5">
            <div
              class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
            >
              <ArrowDownLeft class="h-3.5 w-3.5 text-emerald-700" />
              实时入站
            </div>
            <div class="mt-1 text-base font-semibold">
              {{ realtimeInText }}
            </div>
          </div>
          <div class="rounded-md border bg-muted/20 px-3 py-2.5">
            <div
              class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
            >
              <ArrowUpRight class="h-3.5 w-3.5 text-blue-700" />
              实时出站
            </div>
            <div class="mt-1 text-base font-semibold">
              {{ realtimeOutText }}
            </div>
          </div>
        </div>

        <Tabs v-model="rangeKey" class="w-full">
          <TabsList class="grid w-full grid-cols-5">
            <TabsTrigger
              v-for="range in ranges"
              :key="range.key"
              :value="range.key"
              class="px-2 text-xs"
            >
              {{ range.label }}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div class="grid gap-2 sm:grid-cols-2">
          <div class="rounded-md border px-3 py-2.5">
            <div class="text-xs text-muted-foreground">
              {{ rangeText }}累计入站
            </div>
            <div class="mt-1 text-base font-semibold">
              {{ formatBytes(stats?.totals.inBytes) }}
            </div>
          </div>
          <div class="rounded-md border px-3 py-2.5">
            <div class="text-xs text-muted-foreground">
              {{ rangeText }}累计出站
            </div>
            <div class="mt-1 text-base font-semibold">
              {{ formatBytes(stats?.totals.outBytes) }}
            </div>
          </div>
        </div>

        <div class="h-[140px] w-full overflow-hidden rounded-md border">
          <div
            v-if="isStatsLoading"
            class="flex h-full items-center justify-center p-4"
          >
            <Skeleton class="h-full w-full rounded-md" />
          </div>
          <div
            v-else-if="statsError"
            class="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground"
          >
            {{ statsError }}
          </div>
          <VChart
            v-else
            :option="trafficOption"
            autoresize
            class="h-full w-full"
          />
        </div>
      </div>
    </PopoverContent>
  </Popover>

  <Dialog :open="dialogOpen" @update:open="handleDialogOpenChange">
    <DialogContent
      class="max-h-[88vh] overflow-y-auto p-0 text-left sm:max-w-[28rem]"
    >
      <DialogHeader class="border-b px-4 py-3 pr-10 text-left">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <DialogTitle class="truncate text-base" :title="displayTitle">
              {{ displayTitle }}
            </DialogTitle>
            <DialogDescription class="space-y-1 text-left">
              <span class="block break-all font-medium">{{ host }}</span>
              <span class="block text-xs">{{ sampleStatusText }}</span>
            </DialogDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="h-7 shrink-0 px-2 text-xs"
            @click.stop.prevent="openActiveIpDialog"
          >
            <Network class="h-3.5 w-3.5" />
            {{ activeIpButtonText }}
          </Button>
        </div>
      </DialogHeader>

      <div class="space-y-4 p-4">
        <div class="grid gap-2 sm:grid-cols-2">
          <div class="rounded-md border bg-muted/20 px-3 py-2.5">
            <div
              class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
            >
              <ArrowDownLeft class="h-3.5 w-3.5 text-emerald-700" />
              实时入站
            </div>
            <div class="mt-1 text-base font-semibold">
              {{ realtimeInText }}
            </div>
          </div>
          <div class="rounded-md border bg-muted/20 px-3 py-2.5">
            <div
              class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
            >
              <ArrowUpRight class="h-3.5 w-3.5 text-blue-700" />
              实时出站
            </div>
            <div class="mt-1 text-base font-semibold">
              {{ realtimeOutText }}
            </div>
          </div>
        </div>

        <Tabs v-model="rangeKey" class="w-full">
          <TabsList class="grid w-full grid-cols-5">
            <TabsTrigger
              v-for="range in ranges"
              :key="range.key"
              :value="range.key"
              class="px-2 text-xs"
            >
              {{ range.label }}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div class="grid gap-2 sm:grid-cols-2">
          <div class="rounded-md border px-3 py-2.5">
            <div class="text-xs text-muted-foreground">
              {{ rangeText }}累计入站
            </div>
            <div class="mt-1 text-base font-semibold">
              {{ formatBytes(stats?.totals.inBytes) }}
            </div>
          </div>
          <div class="rounded-md border px-3 py-2.5">
            <div class="text-xs text-muted-foreground">
              {{ rangeText }}累计出站
            </div>
            <div class="mt-1 text-base font-semibold">
              {{ formatBytes(stats?.totals.outBytes) }}
            </div>
          </div>
        </div>

        <div class="h-[140px] w-full overflow-hidden rounded-md border">
          <div
            v-if="isStatsLoading"
            class="flex h-full items-center justify-center p-4"
          >
            <Skeleton class="h-full w-full rounded-md" />
          </div>
          <div
            v-else-if="statsError"
            class="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground"
          >
            {{ statsError }}
          </div>
          <VChart
            v-else
            :option="trafficOption"
            autoresize
            class="h-full w-full"
          />
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <HostActiveIpDialog
    v-model:open="activeIpDialogOpen"
    :title="displayTitle"
    :host="host"
    :items="activeIpItems"
    :loading="activeIpLoading"
    :error="activeIpError"
    :updated-at="activeIpUpdatedAt"
    :window-seconds="activeIpWindowSeconds"
    @refresh="refreshActiveIps"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ArrowDownLeft, ArrowUpRight, Network } from "lucide-vue-next";
import VChart from "vue-echarts";
import type { EChartsOption } from "echarts";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import HostActiveIpDialog from "@/components/host-traffic/HostActiveIpDialog.vue";
import { useHostActiveIps } from "@/composables/useHostActiveIps";
import { DashboardAPI } from "../lib/api";
import type { DashboardStats, HostTrafficStats } from "../types";

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent]);

const ranges = [
  { key: "15m", label: "15分钟", sec: 15 * 60 },
  { key: "1h", label: "1小时", sec: 60 * 60 },
  { key: "6h", label: "6小时", sec: 6 * 60 * 60 },
  { key: "1d", label: "24小时", sec: 24 * 60 * 60 },
  { key: "7d", label: "7天", sec: 7 * 24 * 60 * 60 },
] as const;

type RangeKey = (typeof ranges)[number]["key"];

const props = withDefaults(
  defineProps<{
    host: string;
    title?: string | null;
    sample?: HostTrafficStats | null;
    timestamp?: number | null;
  }>(),
  {
    title: "",
    sample: null,
    timestamp: null,
  },
);

const open = ref(false);
const dialogOpen = ref(false);
const activeIpDialogOpen = ref(false);
const isTouchInteraction = ref(false);
const lastTriggerPointerType = ref<string | null>(null);
const suppressNextFocusOpen = ref(false);
const rangeKey = ref<RangeKey>("1h");
const stats = ref<DashboardStats | null>(null);
const isStatsLoading = ref(false);
const statsError = ref("");
const realtimeInBps = ref<number | null>(null);
const realtimeOutBps = ref<number | null>(null);
let closeTimer: number | null = null;
let statsRequestId = 0;
let lastRealtimeSample: {
  at: number;
  totalIn: number;
  totalOut: number;
} | null = null;
let interactionMediaQuery: MediaQueryList | null = null;

const {
  displayItems: activeIpItems,
  loading: activeIpLoading,
  error: activeIpError,
  updatedAt: activeIpUpdatedAt,
  windowSeconds: activeIpWindowSeconds,
  refresh: refreshActiveIps,
} = useHostActiveIps(computed(() => props.host), activeIpDialogOpen);

const activeRange = computed(
  () => ranges.find((range) => range.key === rangeKey.value) ?? ranges[1]!,
);

const hasRealtimeSample = computed(() => Boolean(props.sample));
const displayTitle = computed(() => props.title?.trim() || "未获取");
const sampleStatusText = computed(() =>
  hasRealtimeSample.value ? "实时采样中" : "等待流量样本",
);

const formatBytes = (bytes: number | null | undefined) => {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const exp = Math.max(
    0,
    Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024))),
  );
  const displayValue = value / 1024 ** exp;
  const digits =
    exp === 0 ? 0 : displayValue >= 100 ? 0 : displayValue >= 10 ? 1 : 2;
  return `${displayValue.toFixed(digits)} ${units[exp] ?? "B"}`;
};

const formatBps = (bps: number | null | undefined) => {
  if (bps === null || bps === undefined) return "-";
  return `${formatBytes(bps)} /s`;
};

const hasRealtimeInTraffic = computed(
  () => Number(realtimeInBps.value ?? 0) > 0,
);
const hasRealtimeOutTraffic = computed(
  () => Number(realtimeOutBps.value ?? 0) > 0,
);
const hasCompactTraffic = computed(
  () => hasRealtimeInTraffic.value || hasRealtimeOutTraffic.value,
);
const compactInText = computed(() => formatBps(realtimeInBps.value));
const compactOutText = computed(() => formatBps(realtimeOutBps.value));
const realtimeInText = computed(() => formatBps(realtimeInBps.value));
const realtimeOutText = computed(() => formatBps(realtimeOutBps.value));
const activeIpButtonText = computed(() => {
  const count = Number(
    props.sample?.active_ip_count ?? activeIpItems.value.length,
  );
  return count > 0 ? `活跃 IP ${count}` : "活跃 IP";
});

const rangeText = computed(() => {
  const sec = stats.value?.rangeSec ?? activeRange.value.sec;
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟`;
  if (sec < 24 * 3600) return `${Math.round(sec / 3600)} 小时`;
  return `${Math.round(sec / 86400)} 天`;
});

const trafficOption = computed<EChartsOption>(() => {
  const base = (stats.value?.traffic.echarts ?? {}) as any;
  const colors = ["#047857", "#1d4ed8"];
  const series = (Array.isArray(base?.series) ? base.series : []).map(
    (item: any, index: number) => ({
      ...item,
      type: "line",
      smooth: true,
      symbol: "none",
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.06, color: colors[index % colors.length] },
      emphasis: { focus: "series" },
    }),
  );

  return {
    ...base,
    color: colors,
    animationDuration: 280,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      backgroundColor: "rgba(0, 0, 0, 0.85)",
      borderColor: "rgba(255,255,255,0.1)",
      textStyle: { color: "#fff" },
      formatter: (params: any) => {
        const items = Array.isArray(params) ? params : [params];
        const timeLabel = items[0]?.axisValueLabel ?? "";
        const lines = [timeLabel];
        for (const item of items) {
          const name = String(item?.seriesName ?? "");
          const value = Array.isArray(item?.data) ? item.data[1] : item?.value;
          lines.push(
            `${item?.marker ?? ""} ${name}: ${formatBps(Number(value))}`,
          );
        }
        return lines.join("<br/>");
      },
    },
    grid: { left: 8, right: 8, top: 14, bottom: 8, containLabel: true },
    xAxis: {
      ...(base?.xAxis ?? {}),
      type: "time",
      boundaryGap: false,
      axisLabel: { color: "#737373" },
      axisLine: { lineStyle: { color: "#e5e5e5" } },
      splitLine: { show: false },
    },
    yAxis: {
      ...(base?.yAxis ?? {}),
      type: "value",
      axisLabel: {
        color: "#737373",
        formatter: (value: number) => formatBytes(value),
      },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: "#f5f5f5" } },
    },
    series,
  } satisfies EChartsOption;
});

const clearCloseTimer = () => {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
};

const updateInteractionMode = () => {
  const nextIsTouchInteraction = Boolean(interactionMediaQuery?.matches);
  isTouchInteraction.value = nextIsTouchInteraction;

  if (nextIsTouchInteraction) {
    open.value = false;
    clearCloseTimer();
    return;
  }

  dialogOpen.value = false;
};

function openPanel() {
  if (isTouchInteraction.value) return;

  clearCloseTimer();
  open.value = true;
}

function scheduleClosePanel() {
  if (isTouchInteraction.value) return;

  clearCloseTimer();
  closeTimer = window.setTimeout(() => {
    open.value = false;
    closeTimer = null;
  }, 140);
}

function handleOpenChange(nextOpen: boolean) {
  clearCloseTimer();
  if (isTouchInteraction.value) {
    open.value = false;
    return;
  }

  open.value = nextOpen;
}

function isMousePointer(event: PointerEvent) {
  return event.pointerType === "mouse";
}

function handleTriggerPointerDown(event: PointerEvent) {
  lastTriggerPointerType.value = event.pointerType;

  if (!isMousePointer(event)) {
    suppressNextFocusOpen.value = true;
    clearCloseTimer();
    open.value = false;
  }
}

function handleTriggerPointerEnter(event: PointerEvent) {
  if (!isMousePointer(event)) return;
  openPanel();
}

function handleTriggerPointerLeave(event: PointerEvent) {
  if (!isMousePointer(event)) return;
  scheduleClosePanel();
}

function handleContentPointerEnter(event: PointerEvent) {
  if (!isMousePointer(event)) return;
  openPanel();
}

function handleContentPointerLeave(event: PointerEvent) {
  if (!isMousePointer(event)) return;
  scheduleClosePanel();
}

function handleTriggerFocus() {
  if (suppressNextFocusOpen.value) return;
  openPanel();
}

function handleTriggerBlur() {
  suppressNextFocusOpen.value = false;
  scheduleClosePanel();
}

function handleTriggerClick() {
  if (
    isTouchInteraction.value ||
    (lastTriggerPointerType.value !== null &&
      lastTriggerPointerType.value !== "mouse")
  ) {
    clearCloseTimer();
    open.value = false;
    dialogOpen.value = true;
    suppressNextFocusOpen.value = false;
    lastTriggerPointerType.value = null;
    return;
  }

  openPanel();
}

function handleDialogOpenChange(nextOpen: boolean) {
  dialogOpen.value = nextOpen;
  if (nextOpen) {
    clearCloseTimer();
    open.value = false;
  }
}

function openActiveIpDialog() {
  clearCloseTimer();
  open.value = false;
  dialogOpen.value = false;
  activeIpDialogOpen.value = true;
}

async function loadStats() {
  const requestId = ++statsRequestId;
  isStatsLoading.value = true;
  statsError.value = "";
  try {
    const result = await DashboardAPI.getStats(activeRange.value.sec, {
      host: props.host,
    });
    if (requestId !== statsRequestId) return;
    stats.value = result;
  } catch (error: any) {
    if (requestId !== statsRequestId) return;
    statsError.value =
      error?.response?.data?.message || error?.message || "流量统计加载失败";
  } finally {
    if (requestId === statsRequestId) {
      isStatsLoading.value = false;
    }
  }
}

watch(
  () => [props.sample, props.timestamp] as const,
  ([sample, timestamp]) => {
    if (!sample) {
      realtimeInBps.value = null;
      realtimeOutBps.value = null;
      lastRealtimeSample = null;
      return;
    }

    const now = Number(timestamp ?? Date.now());
    const totalIn = Number(sample.total_in ?? 0);
    const totalOut = Number(sample.total_out ?? 0);
    if (!Number.isFinite(totalIn) || !Number.isFinite(totalOut)) return;

    if (lastRealtimeSample && Number.isFinite(now)) {
      const dt = Math.max(1, (now - lastRealtimeSample.at) / 1000);
      realtimeInBps.value =
        Math.max(0, totalIn - lastRealtimeSample.totalIn) / dt;
      realtimeOutBps.value =
        Math.max(0, totalOut - lastRealtimeSample.totalOut) / dt;
    }

    lastRealtimeSample = {
      at: Number.isFinite(now) ? now : Date.now(),
      totalIn,
      totalOut,
    };
  },
  { immediate: true },
);

watch(
  () => [open.value, dialogOpen.value, rangeKey.value, props.host] as const,
  ([isPopoverOpen, isDialogOpen]) => {
    if (isPopoverOpen || isDialogOpen) void loadStats();
  },
  { immediate: true },
);

onMounted(() => {
  if (typeof window === "undefined") return;

  interactionMediaQuery = window.matchMedia(
    "(hover: none), (pointer: coarse), (max-width: 767px)",
  );
  updateInteractionMode();

  if (typeof interactionMediaQuery.addEventListener === "function") {
    interactionMediaQuery.addEventListener("change", updateInteractionMode);
    return;
  }

  interactionMediaQuery.addListener(updateInteractionMode);
});

onUnmounted(() => {
  clearCloseTimer();

  if (!interactionMediaQuery) return;

  if (typeof interactionMediaQuery.removeEventListener === "function") {
    interactionMediaQuery.removeEventListener("change", updateInteractionMode);
    return;
  }

  interactionMediaQuery.removeListener(updateInteractionMode);
});
</script>
