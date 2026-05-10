<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRouter } from "vue-router";
import {
  Info,
  Eye,
  Settings,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-vue-next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import RefreshButton from "@/components/RefreshButton.vue";
import SearchInput from "@admin-shared/components/SearchInput.vue";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@admin-shared/utils/toast";
import { GatewayLogsAPI } from "../lib/api";
import type { GatewayLogEntry } from "../types";
import { useConfigStore } from "../store/config";
import ConfirmDangerPopover from "@admin-shared/components/common/ConfirmDangerPopover.vue";
import DetailDialog from "@admin-shared/components/common/DetailDialog.vue";
import DetailFieldsGrid from "@admin-shared/components/common/DetailFieldsGrid.vue";
import TableSkeletonBlock from "@admin-shared/components/list/TableSkeletonBlock.vue";
import HumanFriendlyTime from "@admin-shared/components/common/HumanFriendlyTime.vue";
import {
  extractErrorMessage,
  useAsyncAction,
} from "@admin-shared/composables/useAsyncAction";
import { useDelayedLoading } from "@admin-shared/composables/useDelayedLoading";
import { buildDetailFields } from "@admin-shared/utils/buildDetailFields";
import { formatDateTimeSafe } from "@admin-shared/utils/formatDateTimeSafe";
import DocsLinkButton from "@/components/DocsLinkButton.vue";
import { docsUrls } from "../lib/docs";
import { useIpLocationBatch } from "../composables/useIpLocationBatch";

const router = useRouter();
const configStore = useConfigStore();

const getTodayString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "2xx", label: "2xx 成功" },
  { value: "3xx", label: "3xx 重定向" },
  { value: "4xx", label: "4xx 客户端错误" },
  { value: "5xx", label: "5xx 服务端错误" },
  { value: "401", label: "401 未授权" },
  { value: "403", label: "403 禁止" },
  { value: "404", label: "404 未找到" },
  { value: "500", label: "500 服务异常" },
  { value: "502", label: "502 网关错误" },
  { value: "503", label: "503 服务不可用" },
] as const;
const LOGIN_FILTER_OPTIONS = [
  { value: "all", label: "全部登录状态" },
  { value: "true", label: "已登录" },
  { value: "false", label: "未登录" },
] as const;
const WAF_FILTER_OPTIONS = [
  { value: "all", label: "全部WAF" },
  { value: "has_waf", label: "有 WAF" },
  { value: "none", label: "无 WAF" },
] as const;

const entries = ref<GatewayLogEntry[]>([]);
const logsDir = ref("");
const availableDates = ref<string[]>([]);
const selectedDate = ref(getTodayString());
const selectedStatus =
  ref<(typeof STATUS_FILTER_OPTIONS)[number]["value"]>("all");
const selectedLoggedIn =
  ref<(typeof LOGIN_FILTER_OPTIONS)[number]["value"]>("all");
const selectedWAFStatus =
  ref<(typeof WAF_FILTER_OPTIONS)[number]["value"]>("all");
const limit = ref("20");
const searchQuery = ref("");
const loading = ref(false);
const isDetailsOpen = ref(false);
const activeEntry = ref<GatewayLogEntry | null>(null);
const currentCursor = ref("");
const nextCursor = ref("");
const cursorHistory = ref<string[]>([]);
const tableScrollRef = ref<HTMLElement | null>(null);
const topScrollbarRef = ref<HTMLElement | null>(null);
const tableContentWidth = ref(0);
const tableViewportWidth = ref(0);
const tableScrollLeft = ref(0);

const showTableSkeleton = useDelayedLoading(
  () => loading.value && entries.value.length === 0,
);
const { trackIps, getSnapshot } = useIpLocationBatch();
const isLoggingEnabled = computed(
  () => configStore.config?.gateway_logging?.enabled ?? false,
);
const normalizedStatusQuery = computed(() =>
  selectedStatus.value === "all" ? "" : selectedStatus.value,
);
const normalizedLoggedInQuery = computed(() =>
  selectedLoggedIn.value === "all" ? "" : selectedLoggedIn.value,
);
const normalizedWAFStatusQuery = computed(() =>
  selectedWAFStatus.value === "all" ? "" : selectedWAFStatus.value,
);
const activeStatusLabel = computed(
  () =>
    STATUS_FILTER_OPTIONS.find((item) => item.value === selectedStatus.value)
      ?.label || "全部状态",
);
const activeLoggedInLabel = computed(
  () =>
    LOGIN_FILTER_OPTIONS.find((item) => item.value === selectedLoggedIn.value)
      ?.label || "全部登录状态",
);
const activeWAFStatusLabel = computed(
  () =>
    WAF_FILTER_OPTIONS.find((item) => item.value === selectedWAFStatus.value)
      ?.label || "全部 WAF",
);
const hasHorizontalOverflow = computed(
  () => tableContentWidth.value > tableViewportWidth.value + 1,
);
const canScrollLeft = computed(
  () => hasHorizontalOverflow.value && tableScrollLeft.value > 1,
);
const canScrollRight = computed(
  () =>
    hasHorizontalOverflow.value &&
    tableScrollLeft.value + tableViewportWidth.value <
      tableContentWidth.value - 1,
);
const canLoadNewer = computed(() => cursorHistory.value.length > 0);
const canLoadOlder = computed(() => Boolean(nextCursor.value));
const cursorPageLabel = computed(
  () => `第 ${cursorHistory.value.length + 1} 段`,
);

let resizeObserver: ResizeObserver | null = null;
let isSyncingHorizontalScroll = false;

const { isPending: isDeleting, run: runDelete } = useAsyncAction({
  onError: (error) => {
    toast.error("删除失败", {
      description: extractErrorMessage(error, "删除请求日志失败"),
    });
  },
});

const applyDates = (dates: string[], preferred?: string) => {
  const fallbackToday = getTodayString();
  const nextDates = dates.length > 0 ? dates : [fallbackToday];
  availableDates.value = nextDates;

  if (preferred && nextDates.includes(preferred)) {
    selectedDate.value = preferred;
    return;
  }
  if (nextDates.includes(selectedDate.value)) {
    return;
  }
  if (nextDates.includes(fallbackToday)) {
    selectedDate.value = fallbackToday;
    return;
  }
  selectedDate.value = nextDates[0] || fallbackToday;
};

const fetchDates = async (preferred?: string) => {
  const data = await GatewayLogsAPI.getDates();
  logsDir.value = data.logs_dir || "";
  applyDates(data.dates || [], preferred || data.today || selectedDate.value);
};

const fetchEntries = async () => {
  loading.value = true;
  try {
    const data = await GatewayLogsAPI.getEntries({
      date: selectedDate.value,
      pagination: "cursor",
      limit: limit.value,
      cursor: currentCursor.value || undefined,
      search: searchQuery.value || undefined,
      status: normalizedStatusQuery.value || undefined,
      logged_in: normalizedLoggedInQuery.value || undefined,
      waf_status: normalizedWAFStatusQuery.value || undefined,
    });
    logsDir.value = data.logs_dir || "";
    entries.value = data.items || [];
    trackIps(entries.value.map((entry) => getEntryClientIp(entry)));
    nextCursor.value = data.next_cursor || "";
    applyDates(data.available_dates || [], data.date || selectedDate.value);
  } catch (error) {
    entries.value = [];
    trackIps([]);
    nextCursor.value = "";
    toast.error("加载失败", {
      description: extractErrorMessage(error, "请求日志加载失败"),
    });
  } finally {
    loading.value = false;
  }
};

const updateHorizontalOverflow = () => {
  const scrollEl = tableScrollRef.value;
  tableViewportWidth.value = scrollEl?.clientWidth || 0;
  tableContentWidth.value = scrollEl?.scrollWidth || 0;
  tableScrollLeft.value = scrollEl?.scrollLeft || 0;
};

const syncHorizontalScroll = (source: "table" | "top") => {
  if (isSyncingHorizontalScroll) return;

  const tableEl = tableScrollRef.value;
  const topEl = topScrollbarRef.value;
  if (!tableEl || !topEl) return;

  isSyncingHorizontalScroll = true;
  if (source === "table") {
    topEl.scrollLeft = tableEl.scrollLeft;
  } else {
    tableEl.scrollLeft = topEl.scrollLeft;
  }

  requestAnimationFrame(() => {
    isSyncingHorizontalScroll = false;
  });
};

const bindTableResizeObserver = () => {
  resizeObserver?.disconnect();
  resizeObserver = null;

  if (typeof ResizeObserver === "undefined" || !tableScrollRef.value) {
    updateHorizontalOverflow();
    return;
  }

  resizeObserver = new ResizeObserver(() => {
    updateHorizontalOverflow();
  });

  resizeObserver.observe(tableScrollRef.value);

  const tableEl = tableScrollRef.value.querySelector("table");
  if (tableEl instanceof HTMLElement) {
    resizeObserver.observe(tableEl);
  }

  updateHorizontalOverflow();
};

const refreshAll = async () => {
  await fetchDates(selectedDate.value);
  currentCursor.value = "";
  nextCursor.value = "";
  cursorHistory.value = [];
  await fetchEntries();
};

const resetCursorPagination = () => {
  currentCursor.value = "";
  nextCursor.value = "";
  cursorHistory.value = [];
};

const handleDateChange = async (value: unknown) => {
  if (!value) return;
  selectedDate.value = String(value);
  resetCursorPagination();
  await fetchEntries();
};

const handleSearch = async () => {
  resetCursorPagination();
  await fetchEntries();
};

const handleStatusChange = async (value: unknown) => {
  if (!value) return;
  selectedStatus.value = String(
    value,
  ) as (typeof STATUS_FILTER_OPTIONS)[number]["value"];
  resetCursorPagination();
  await fetchEntries();
};
const handleLoggedInChange = async (value: unknown) => {
  if (!value) return;
  selectedLoggedIn.value = String(
    value,
  ) as (typeof LOGIN_FILTER_OPTIONS)[number]["value"];
  resetCursorPagination();
  await fetchEntries();
};

const handleWAFStatusChange = async (value: unknown) => {
  if (!value) return;
  selectedWAFStatus.value = String(
    value,
  ) as (typeof WAF_FILTER_OPTIONS)[number]["value"];
  resetCursorPagination();
  await fetchEntries();
};

const handleLimitChange = async (value: unknown) => {
  if (!value) return;
  limit.value = String(value);
  resetCursorPagination();
  await fetchEntries();
};

const handleLoadOlder = async () => {
  if (!nextCursor.value || loading.value) return;
  cursorHistory.value = [...cursorHistory.value, currentCursor.value];
  currentCursor.value = nextCursor.value;
  await fetchEntries();
};

const handleLoadNewer = async () => {
  if (cursorHistory.value.length === 0 || loading.value) return;
  const history = [...cursorHistory.value];
  const previousCursor = history.pop() ?? "";
  cursorHistory.value = history;
  currentCursor.value = previousCursor;
  await fetchEntries();
};

const handleLoadFirst = async () => {
  if (cursorHistory.value.length === 0 || loading.value) return;
  resetCursorPagination();
  await fetchEntries();
};

const viewDetails = (entry: GatewayLogEntry) => {
  activeEntry.value = entry;
  isDetailsOpen.value = true;
};

const deleteSelectedDate = async () => {
  await runDelete(() => GatewayLogsAPI.deleteDate(selectedDate.value), {
    onSuccess: async (data) => {
      toast.success(
        data.deleted
          ? `${selectedDate.value} 日志已删除`
          : `${selectedDate.value} 没有可删除的日志`,
      );
      searchQuery.value = "";
      selectedStatus.value = "all";
      selectedLoggedIn.value = "all";
      selectedWAFStatus.value = "all";
      resetCursorPagination();
      const nextPreferred =
        data.available_dates.find((item) => item !== selectedDate.value) ||
        getTodayString();
      await fetchDates(nextPreferred);
      await fetchEntries();
    },
  });
};

const goToSettings = () => {
  router.push({ path: "/system", query: { tab: "gateway-logging" } });
};

const goToWAFTrace = (traceId?: string) => {
  if (!traceId) return;
  router.push({ path: "/waf-logs", query: { trace_id: traceId } });
};

const wafActionLabel = (value?: string) => {
  switch (value) {
    case "block":
    case "deny":
      return "阻断";
    case "log":
    case "detect":
      return "记录";
    case "pass":
      return "放行";
    default:
      return value || "-";
  }
};

const formatRuleIds = (value?: number[]) =>
  value && value.length > 0 ? value.join(", ") : "-";

const hasWAFSignal = (entry: GatewayLogEntry) =>
  Boolean(entry.waf_trace_id) ||
  Boolean(entry.waf_bundle) ||
  Boolean(entry.waf_action) ||
  entry.waf_blocked === true ||
  (Array.isArray(entry.waf_rule_ids) && entry.waf_rule_ids.length > 0);

const getWAFAction = (entry: GatewayLogEntry) =>
  String(entry.waf_action || "").toLowerCase();

const isWAFBlocked = (entry: GatewayLogEntry) =>
  entry.waf_blocked === true ||
  getWAFAction(entry) === "block" ||
  getWAFAction(entry) === "deny";

const wafBadgeLabel = (entry: GatewayLogEntry) => {
  if (isWAFBlocked(entry)) return "WAF 阻断";
  const action = getWAFAction(entry);
  if (action === "pass") return "WAF 放行";
  if (action === "log" || action === "detect") return "WAF 记录";
  return "WAF 命中";
};

const wafBadgeClass = (entry: GatewayLogEntry) => {
  if (isWAFBlocked(entry)) {
    return "border-red-500/20 bg-transparent text-red-600/80 hover:bg-red-500/[0.04] dark:text-red-300/80";
  }
  if (getWAFAction(entry) === "pass") {
    return "border-emerald-500/20 bg-transparent text-emerald-600/80 hover:bg-emerald-500/[0.04] dark:text-emerald-300/80";
  }
  return "border-muted-foreground/20 bg-transparent text-muted-foreground hover:bg-muted/30";
};

const wafBadgeMeta = (entry: GatewayLogEntry) => {
  if (entry.waf_rule_ids?.length) {
    return entry.waf_rule_ids.map((id) => `#${id}`).join(" ");
  }
  return entry.waf_trace_id || wafActionLabel(entry.waf_action);
};

const wafBadgeTitle = (entry: GatewayLogEntry) => {
  const parts = [wafBadgeLabel(entry)];
  if (entry.waf_trace_id) parts.push(`Trace: ${entry.waf_trace_id}`);
  if (entry.waf_rule_ids?.length) {
    parts.push(`规则: ${entry.waf_rule_ids.join(", ")}`);
  }
  if (entry.waf_bundle) parts.push(`规则包: ${entry.waf_bundle}`);
  return parts.join(" · ");
};

const statusTextClass = (status: number) => {
  if (status >= 500) return "text-red-600";
  if (status >= 400) return "text-amber-600";
  return "text-foreground";
};

const statusDotClass = (status: number) => {
  if (status >= 500) return "bg-red-500";
  if (status >= 400) return "bg-amber-500";
  return "bg-muted-foreground/35";
};

const routeTypeLabel = (value?: string) => {
  switch (value) {
    case "path_rule":
      return "路径规则";
    case "host_rule":
      return "Host 规则";
    case "auth_proxy":
      return "鉴权代理";
    case "select":
      return "选择页";
    case "preflight":
      return "预检";
    case "slash_redirect":
      return "补斜杠";
    case "favicon":
      return "图标";
    case "not_found":
      return "未命中";
    default:
      return value || "-";
  }
};

const authDecisionLabel = (value?: string) => {
  switch (value) {
    case "passed":
      return "已通过";
    case "redirected":
      return "已跳转";
    case "denied":
      return "已拒绝";
    case "root_mode_redirect":
      return "根路径跳转";
    case "not_required":
      return "无需鉴权";
    case "proxy":
      return "代理转发";
    case "error":
      return "鉴权异常";
    default:
      return value || "-";
  }
};

const formatDuration = (value?: number) => {
  if (!Number.isFinite(value)) return "-";
  return `${value} ms`;
};

const formatBoolean = (value?: boolean) => {
  return value ? "是" : "否";
};

const formatDate = (value?: string) => formatDateTimeSafe(value);

const getEntryClientIp = (entry: GatewayLogEntry) =>
  entry.client_ip || entry.remote_ip || "";

const getEntryIpSnapshot = (entry: GatewayLogEntry) =>
  getSnapshot(getEntryClientIp(entry));

const getEntryIpLocation = (entry: GatewayLogEntry) =>
  getEntryIpSnapshot(entry)?.location || entry.ipLocation || "";

const getEntryIpLocationText = (entry: GatewayLogEntry) => {
  const snapshot = getEntryIpSnapshot(entry);
  const location = snapshot?.location || entry.ipLocation || "";
  if (location) return location;

  if (snapshot?.status === "queued" || snapshot?.status === "processing") {
    return "属地解析中...";
  }

  if (snapshot?.status === "failed") {
    return "属地暂未获取";
  }

  return "";
};

const getForwardedHeaderLines = (entry: GatewayLogEntry) => {
  const lines: string[] = [];

  if (entry.eo_connecting_ip) {
    lines.push(`EO-Connecting-IP: ${entry.eo_connecting_ip}`);
  }
  if (entry.ali_real_client_ip) {
    lines.push(`Ali-Real-Client-IP: ${entry.ali_real_client_ip}`);
  }
  if (entry.x_forwarded_for) {
    lines.push(`X-Forwarded-For: ${entry.x_forwarded_for}`);
  }
  if (entry.x_real_ip) {
    lines.push(`X-Real-IP: ${entry.x_real_ip}`);
  }

  return lines;
};

const getConnectionSourceText = (entry: GatewayLogEntry) => {
  const clientIp = getEntryClientIp(entry);
  const remoteIp = entry.remote_ip || "";
  if (!remoteIp || remoteIp === clientIp) return "";
  return `连接来源: ${remoteIp}`;
};

const displayedEntries = computed(() =>
  entries.value.map((entry) => ({
    ...entry,
    client_ip: getEntryClientIp(entry),
    ipLocation: getEntryIpLocation(entry),
  })),
);

const activeEntryWithIpLocation = computed(() =>
  activeEntry.value
    ? {
        ...activeEntry.value,
        client_ip: getEntryClientIp(activeEntry.value),
        ipLocation: getEntryIpLocation(activeEntry.value),
      }
    : null,
);

const detailFields = [
  { key: "time", label: "时间" },
  { key: "method", label: "方法" },
  { key: "scheme", label: "协议" },
  { key: "host", label: "Host" },
  { key: "path", label: "路径" },
  { key: "query", label: "Query" },
  { key: "request_uri", label: "请求地址" },
  { key: "protocol", label: "HTTP 协议" },
  { key: "status", label: "状态码" },
  { key: "duration_ms", label: "耗时" },
  { key: "client_ip", label: "客户端 IP" },
  { key: "ipLocation", label: "属地" },
  { key: "remote_ip", label: "连接来源 IP" },
  { key: "remote_addr", label: "连接来源地址" },
  { key: "user_agent", label: "User-Agent" },
  { key: "referer", label: "Referer" },
  { key: "logged_in", label: "已登录" },
  { key: "auth_required", label: "需要鉴权" },
  { key: "auth_decision", label: "鉴权结果" },
  { key: "access_mode", label: "访问模式" },
  { key: "route_type", label: "路由类型" },
  { key: "route_key", label: "路由键" },
  { key: "upstream", label: "上游目标" },
  { key: "matched", label: "命中规则" },
  { key: "bytes_in", label: "请求字节" },
  { key: "bytes_out", label: "响应字节" },
  { key: "tls", label: "TLS" },
  { key: "websocket", label: "WebSocket" },
  { key: "eo_connecting_ip", label: "EO-Connecting-IP" },
  { key: "ali_real_client_ip", label: "Ali-Real-Client-IP" },
  { key: "x_forwarded_for", label: "X-Forwarded-For" },
  { key: "x_real_ip", label: "X-Real-IP" },
  { key: "waf_blocked", label: "WAF 已阻断" },
  { key: "waf_trace_id", label: "WAF Trace ID" },
  { key: "waf_mode", label: "WAF 模式" },
  { key: "waf_action", label: "WAF 动作" },
  { key: "waf_rule_ids", label: "WAF 规则 ID" },
  { key: "waf_bundle", label: "WAF 规则包" },
] as const;

const detailItems = computed(() =>
  buildDetailFields(activeEntryWithIpLocation.value, detailFields, {
    format: (key, value) => {
      if (key === "time") return formatDate(value);
      if (key === "duration_ms") return formatDuration(value);
      if (
        key === "logged_in" ||
        key === "auth_required" ||
        key === "matched" ||
        key === "tls" ||
        key === "websocket" ||
        key === "waf_blocked"
      ) {
        return formatBoolean(Boolean(value));
      }
      if (key === "route_type") return routeTypeLabel(String(value || ""));
      if (key === "auth_decision")
        return authDecisionLabel(String(value || ""));
      if (key === "waf_action") return wafActionLabel(String(value || ""));
      if (key === "waf_rule_ids") return formatRuleIds(value as number[]);
      if (value === undefined || value === null || value === "") return "-";
      return value;
    },
  }),
);

const detailCopyText = computed(() =>
  detailItems.value
    .map((item) => `${item.label}：${String(item.value)}`)
    .join("\n"),
);

watch(
  [entries, loading],
  async () => {
    await nextTick();
    bindTableResizeObserver();
  },
  { flush: "post" },
);

onMounted(async () => {
  await fetchDates(selectedDate.value);
  await fetchEntries();
  await nextTick();
  bindTableResizeObserver();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <div class="flex h-full flex-col gap-3">
    <div
      class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
    >
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <h1 class="text-lg font-semibold tracking-tight">请求日志</h1>
          <span class="text-xs text-muted-foreground">{{ selectedDate }}</span>
        </div>
        <p class="text-sm text-muted-foreground">
          按天筛选，快速看认证、路由和状态。
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <DocsLinkButton :href="docsUrls.guides.requestLogs" />
        <RefreshButton
          :loading="loading"
          :disabled="loading"
          @click="refreshAll"
        />
        <ConfirmDangerPopover
          :title="`确认删除 ${selectedDate} 的请求日志？`"
          description="删除后当天日志文件将不可恢复。"
          :loading="isDeleting"
          :disabled="isDeleting"
          :on-confirm="deleteSelectedDate"
        >
          <template #trigger>
            <Button
              variant="outline"
              class="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              :disabled="isDeleting"
            >
              <Trash2 class="mr-2 h-4 w-4" />
              删除当天
            </Button>
          </template>
        </ConfirmDangerPopover>
      </div>
    </div>

    <Alert
      v-if="!isLoggingEnabled"
      class="flex items-center gap-3 rounded-lg border-dashed bg-muted/20 px-4 py-3 text-foreground shadow-none"
    >
      <Info class="h-4 w-4 shrink-0 text-muted-foreground" />
      <div
        class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <p class="text-sm text-muted-foreground">
          当前未记录新请求，仍可查看历史日志。
        </p>
        <Button variant="ghost" class="shrink-0" @click="goToSettings">
          <Settings class="mr-2 h-4 w-4" />
          去设置
        </Button>
      </div>
    </Alert>

    <div
      class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background"
    >
      <div class="border-b px-4 py-3">
        <div class="flex flex-col gap-2 xl:flex-row xl:items-center">
          <SearchInput
            v-model="searchQuery"
            placeholder="搜索 IP、Host、路径、状态码、UA、上游目标..."
            class="w-full xl:w-[320px] xl:max-w-[320px]"
            @search="handleSearch"
          />

          <div class="flex flex-1 flex-wrap items-center gap-2">
            <Select
              :model-value="selectedDate"
              @update:model-value="handleDateChange"
            >
              <div class="w-[148px]">
                <SelectTrigger>
                  <SelectValue placeholder="日期" />
                </SelectTrigger>
              </div>
              <SelectContent>
                <SelectItem
                  v-for="date in availableDates"
                  :key="date"
                  :value="date"
                >
                  {{ date }}
                </SelectItem>
              </SelectContent>
            </Select>

            <Select
              :model-value="selectedStatus"
              @update:model-value="handleStatusChange"
            >
              <div class="w-[156px]">
                <SelectTrigger>
                  <SelectValue placeholder="状态码" />
                </SelectTrigger>
              </div>
              <SelectContent>
                <SelectItem
                  v-for="option in STATUS_FILTER_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>

            <Select
              :model-value="selectedLoggedIn"
              @update:model-value="handleLoggedInChange"
            >
              <div class="w-[156px]">
                <SelectTrigger>
                  <SelectValue placeholder="登录状态" />
                </SelectTrigger>
              </div>
              <SelectContent>
                <SelectItem
                  v-for="option in LOGIN_FILTER_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>

            <Select
              :model-value="selectedWAFStatus"
              @update:model-value="handleWAFStatusChange"
            >
              <div class="w-[148px]">
                <SelectTrigger>
                  <SelectValue placeholder="WAF 状态" />
                </SelectTrigger>
              </div>
              <SelectContent>
                <SelectItem
                  v-for="option in WAF_FILTER_OPTIONS"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div
          class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
        >
          <span>{{ cursorPageLabel }} · {{ entries.length }} 条</span>
          <span>{{ activeStatusLabel }}</span>
          <span>{{ activeLoggedInLabel }}</span>
          <span>{{ activeWAFStatusLabel }}</span>
          <span v-if="searchQuery.trim()"
            >关键词：{{ searchQuery.trim() }}</span
          >
          <span class="break-all">目录：{{ logsDir || "-" }}</span>
        </div>
      </div>

      <div v-if="hasHorizontalOverflow" class="border-b px-4 py-2">
        <div
          ref="topScrollbarRef"
          class="overflow-x-auto overscroll-x-contain rounded-full bg-muted/35 p-1"
          @scroll="syncHorizontalScroll('top')"
        >
          <div
            class="h-1.5 rounded-full bg-foreground/20"
            :style="{
              width: `${Math.max(tableContentWidth, tableViewportWidth)}px`,
            }"
          ></div>
        </div>
      </div>

      <div class="relative flex-1 overflow-hidden">
        <div
          v-if="canScrollLeft"
          class="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent"
        ></div>
        <div
          v-if="canScrollRight"
          class="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent"
        ></div>

        <div
          ref="tableScrollRef"
          class="h-full overflow-auto overscroll-x-contain"
          @scroll="syncHorizontalScroll('table')"
        >
          <Table
            v-if="!(loading && entries.length === 0)"
            class="min-w-[980px]"
          >
            <TableHeader
              class="sticky top-0 z-10 bg-background/95 backdrop-blur"
            >
              <TableRow>
                <TableHead
                  class="h-10 w-[320px] min-w-[320px] max-w-[320px] text-[11px] font-medium text-muted-foreground"
                  >请求</TableHead
                >
                <TableHead
                  class="h-10 text-[11px] font-medium text-muted-foreground"
                  >状态</TableHead
                >
                <TableHead
                  class="h-10 text-[11px] font-medium text-muted-foreground"
                  >登录</TableHead
                >
                <TableHead
                  class="h-10 text-[11px] font-medium text-muted-foreground"
                  >客户端 IP</TableHead
                >
                <TableHead
                  class="h-10 text-[11px] font-medium text-muted-foreground"
                  >路由</TableHead
                >
                <TableHead
                  class="h-10 text-[11px] font-medium text-muted-foreground"
                  >耗时</TableHead
                >
                <TableHead
                  class="sticky right-0 z-20 h-10 bg-background/95 pr-4 text-right text-[11px] font-medium text-muted-foreground"
                  >操作</TableHead
                >
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-if="loading">
                <TableCell
                  colspan="7"
                  class="py-10 text-center text-muted-foreground"
                >
                  加载中...
                </TableCell>
              </TableRow>
              <TableRow v-else-if="entries.length === 0">
                <TableCell
                  colspan="7"
                  class="py-10 text-center text-muted-foreground"
                >
                  暂无请求日志
                </TableCell>
              </TableRow>
              <TableRow
                v-else
                v-for="entry in displayedEntries"
                :key="`${entry.time}-${entry.request_uri}-${entry.remote_ip}`"
                class="align-top"
              >
                <TableCell
                  class="w-[320px] min-w-[320px] max-w-[320px] whitespace-normal py-2.5"
                >
                  <div class="space-y-1.5">
                    <div class="flex items-start gap-2">
                      <div
                        class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium leading-5 text-muted-foreground"
                      >
                        <HumanFriendlyTime :value="entry.time" />
                      </div>
                      <div class="min-w-0 flex-1">
                        <div
                          class="flex items-center gap-2 text-sm text-foreground"
                        >
                          <span
                            class="font-mono text-[11px] tracking-[0.12em] text-muted-foreground"
                          >
                            {{ entry.method || "-" }}
                          </span>
                          <span class="min-w-0 flex-1 truncate">{{
                            entry.host || "-"
                          }}</span>
                        </div>
                      </div>
                    </div>
                    <div
                      class="whitespace-normal break-all font-mono text-[11px] leading-5 text-muted-foreground"
                    >
                      {{ entry.request_uri || entry.path || "-" }}
                    </div>
                    <div
                      v-if="entry.upstream"
                      class="whitespace-normal break-all text-[11px] text-muted-foreground/75"
                    >
                      {{ entry.upstream }}
                    </div>
                    <button
                      v-if="hasWAFSignal(entry)"
                      type="button"
                      class="inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-normal leading-4 transition-colors disabled:cursor-default disabled:opacity-70"
                      :class="wafBadgeClass(entry)"
                      :title="wafBadgeTitle(entry)"
                      :disabled="!entry.waf_trace_id"
                      @click.stop="goToWAFTrace(entry.waf_trace_id)"
                    >
                      <ShieldX
                        v-if="isWAFBlocked(entry)"
                        class="h-2.5 w-2.5 shrink-0"
                      />
                      <ShieldCheck
                        v-else-if="getWAFAction(entry) === 'pass'"
                        class="h-2.5 w-2.5 shrink-0"
                      />
                      <ShieldAlert v-else class="h-2.5 w-2.5 shrink-0" />
                      <span class="shrink-0">{{ wafBadgeLabel(entry) }}</span>
                      <span class="truncate font-mono">{{
                        wafBadgeMeta(entry)
                      }}</span>
                    </button>
                  </div>
                </TableCell>
                <TableCell class="py-2.5">
                  <div
                    class="flex items-center gap-2 font-mono text-sm"
                    :class="statusTextClass(entry.status)"
                  >
                    <span
                      class="h-1.5 w-1.5 rounded-full"
                      :class="statusDotClass(entry.status)"
                    ></span>
                    <span>{{ entry.status }}</span>
                  </div>
                </TableCell>
                <TableCell class="py-2.5">
                  <div class="text-sm text-foreground">
                    {{ entry.logged_in ? "已登录" : "未登录" }}
                  </div>
                  <div class="text-[11px] text-muted-foreground">
                    {{ authDecisionLabel(entry.auth_decision) }}
                  </div>
                </TableCell>
                <TableCell class="min-w-[140px] py-2.5">
                  <div class="font-mono text-sm text-foreground">
                    {{ getEntryClientIp(entry) || "-" }}
                  </div>
                  <div
                    v-if="getConnectionSourceText(entry)"
                    class="break-all text-[10px] text-muted-foreground/75"
                  >
                    {{ getConnectionSourceText(entry) }}
                  </div>
                  <div
                    v-if="getEntryIpLocationText(entry)"
                    class="text-[11px] text-muted-foreground"
                  >
                    {{ getEntryIpLocationText(entry) }}
                  </div>
                  <div
                    v-for="headerLine in getForwardedHeaderLines(entry)"
                    :key="headerLine"
                    class="break-all text-[10px] text-muted-foreground/75"
                  >
                    {{ headerLine }}
                  </div>
                </TableCell>
                <TableCell class="min-w-[110px] py-2.5">
                  <div class="text-sm text-foreground">
                    {{ routeTypeLabel(entry.route_type) }}
                  </div>
                  <div class="break-all text-[11px] text-muted-foreground">
                    {{ entry.route_key || "-" }}
                  </div>
                </TableCell>
                <TableCell
                  class="whitespace-nowrap py-2.5 font-mono text-sm text-muted-foreground"
                >
                  {{ formatDuration(entry.duration_ms) }}
                </TableCell>
                <TableCell
                  class="sticky right-0 z-10 bg-background py-2.5 pr-4 text-right"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-8 w-8 text-muted-foreground hover:text-foreground"
                    @click="viewDetails(entry)"
                  >
                    <Eye class="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <TableSkeletonBlock
            v-else-if="showTableSkeleton"
            :header-widths="[
              'w-56',
              'w-16',
              'w-16',
              'w-20',
              'w-20',
              'w-14',
              'w-10',
            ]"
            :row-widths="[
              'w-64',
              'w-12',
              'w-20',
              'w-24',
              'w-24',
              'w-14',
              'w-10',
            ]"
          />
          <div v-else class="h-[380px]" aria-hidden="true"></div>
        </div>
      </div>

      <div class="border-t px-4 py-3">
        <div
          class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <div
            class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
          >
            <span>{{ cursorPageLabel }}</span>
            <span>{{
              canLoadOlder ? "可继续翻到更早记录" : "已经是最后一页"
            }}</span>
          </div>

          <div class="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              class="h-8 px-3"
              :disabled="loading || !canLoadNewer"
              @click="handleLoadFirst"
            >
              <ChevronsLeft class="mr-1.5 h-4 w-4" />
              首页
            </Button>
            <Button
              variant="outline"
              class="h-8 px-3"
              :disabled="loading || !canLoadNewer"
              @click="handleLoadNewer"
            >
              <ChevronLeft class="mr-1.5 h-4 w-4" />
              上一页
            </Button>
            <Button
              class="h-8 px-3"
              :disabled="loading || !canLoadOlder"
              @click="handleLoadOlder"
            >
              下一页
              <ChevronRight class="ml-1.5 h-4 w-4" />
            </Button>

            <div
              class="ml-1 flex items-center gap-2 text-xs text-muted-foreground"
            >
              <span>每页显示</span>
              <Select
                :model-value="limit"
                @update:model-value="handleLimitChange"
              >
                <div class="w-[96px]">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </div>
                <SelectContent>
                  <SelectItem value="10">10 条</SelectItem>
                  <SelectItem value="20">20 条</SelectItem>
                  <SelectItem value="50">50 条</SelectItem>
                  <SelectItem value="100">100 条</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>
    </div>

    <DetailDialog
      v-model:open="isDetailsOpen"
      title="请求日志详情"
      description="查看此条网关请求日志的完整字段。"
      max-width-class="sm:max-w-[640px]"
      close-variant="default"
      :copy-text="detailCopyText"
    >
      <div v-if="activeEntry">
        <DetailFieldsGrid :items="detailItems" />
      </div>
    </DetailDialog>
  </div>
</template>
