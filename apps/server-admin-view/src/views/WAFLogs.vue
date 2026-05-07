<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  Eye,
  Settings,
  ShieldAlert,
  Trash2,
} from "lucide-vue-next";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { WAFAPI } from "../lib/api";
import type { WAFEvent, WAFInterruptionInfo, WAFRuleMatch } from "../types";
import { useConfigStore } from "../store/config";
import ConfirmDangerPopover from "@admin-shared/components/common/ConfirmDangerPopover.vue";
import DetailDialog from "@admin-shared/components/common/DetailDialog.vue";
import DetailFieldsGrid from "@admin-shared/components/common/DetailFieldsGrid.vue";
import HumanFriendlyTime from "@admin-shared/components/common/HumanFriendlyTime.vue";
import {
  extractErrorMessage,
  useAsyncAction,
} from "@admin-shared/composables/useAsyncAction";
import { buildDetailFields } from "@admin-shared/utils/buildDetailFields";
import { formatDateTimeSafe } from "@admin-shared/utils/formatDateTimeSafe";
import {
  normalizeIpKey,
  useIpLocationBatch,
} from "../composables/useIpLocationBatch";

const LIMIT_OPTIONS = ["20", "50", "100", "200"] as const;
const AUTO_REFRESH_MS = 5_000;
const WAF_RULE_PATH_PREFIX = "/usr/local/apps/@appdata/fn-knock/waf";

const getTodayString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const route = useRoute();
const router = useRouter();
const configStore = useConfigStore();

const entries = ref<WAFEvent[]>([]);
const availableDates = ref<string[]>([getTodayString()]);
const selectedDate = ref(getTodayString());
const limit = ref("50");
const searchQuery = ref("");
const traceFilter = ref(String(route.query.trace_id || ""));
const loading = ref(false);
const isDetailsOpen = ref(false);
const activeEvent = ref<WAFEvent | null>(null);
const currentCursor = ref("");
const nextCursor = ref("");
const cursorHistory = ref<string[]>([]);
let autoRefreshTimer: number | null = null;

const { trackIps, getSnapshot } = useIpLocationBatch();
const isWAFEnabled = computed(() => configStore.config?.waf?.enabled ?? false);
const canLoadNewer = computed(() => cursorHistory.value.length > 0);
const canLoadOlder = computed(() => Boolean(nextCursor.value));
const cursorPageLabel = computed(
  () => `第 ${cursorHistory.value.length + 1} 段`,
);

const { isPending: isDeleting, run: runDelete } = useAsyncAction({
  onError: (error) => {
    toast.error("删除失败", {
      description: extractErrorMessage(error, "删除 WAF 日志失败"),
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
  if (nextDates.includes(selectedDate.value)) return;
  selectedDate.value = nextDates.includes(fallbackToday)
    ? fallbackToday
    : nextDates[0] || fallbackToday;
};

const resetCursorPagination = () => {
  currentCursor.value = "";
  nextCursor.value = "";
  cursorHistory.value = [];
};

const drainEventsSilently = async (silent = true) => {
  try {
    await WAFAPI.drainEvents();
  } catch (error) {
    if (!silent) {
      toast.error("拉取失败", {
        description: extractErrorMessage(error, "WAF 事件拉取失败"),
      });
    }
  }
};

const fetchEntries = async (
  options: { silent?: boolean; drain?: boolean } = {},
) => {
  if (loading.value) return;
  loading.value = true;
  try {
    if (options.drain) {
      await drainEventsSilently(options.silent !== false);
    }
    const data = await WAFAPI.getLogs({
      date: selectedDate.value,
      trace_id: traceFilter.value.trim() || undefined,
      search: searchQuery.value.trim() || undefined,
      cursor: currentCursor.value || undefined,
      limit: limit.value,
    });
    entries.value = data.items || [];
    trackIps(entries.value.map((entry) => getEntrySourceIp(entry)));
    nextCursor.value = data.next_cursor || "";
    applyDates(data.available_dates || [], data.date || selectedDate.value);
  } catch (error) {
    trackIps([]);
    if (!options.silent) {
      entries.value = [];
      nextCursor.value = "";
      toast.error("加载失败", {
        description: extractErrorMessage(error, "WAF 日志加载失败"),
      });
    }
  } finally {
    loading.value = false;
  }
};

const refreshAll = async () => {
  resetCursorPagination();
  await fetchEntries({ drain: true, silent: false });
};

const handleSearch = async () => {
  resetCursorPagination();
  await fetchEntries();
};

const handleDateChange = async (value: unknown) => {
  if (!value) return;
  selectedDate.value = String(value);
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

const deleteSelectedDate = async () => {
  await runDelete(() => WAFAPI.deleteLogs(selectedDate.value), {
    onSuccess: async (data) => {
      toast.success(
        data.deleted
          ? `${selectedDate.value} WAF 日志已删除`
          : `${selectedDate.value} 没有可删除的 WAF 日志`,
      );
      searchQuery.value = "";
      traceFilter.value = "";
      resetCursorPagination();
      applyDates(data.available_dates, getTodayString());
      await fetchEntries();
    },
  });
};

const viewDetails = (event: WAFEvent) => {
  activeEvent.value = event;
  isDetailsOpen.value = true;
};

const goToSettings = () => {
  router.push({ path: "/system", query: { tab: "waf" } });
};

const actionLabel = (value?: string) => {
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

const actionVariant = (value?: string) => {
  if (value === "block" || value === "deny") return "destructive";
  if (value === "log" || value === "detect") return "secondary";
  return "outline";
};

const modeLabel = (value?: string) => {
  switch (value) {
    case "detection":
      return "检测";
    case "blocking":
      return "阻断";
    case "off":
      return "关闭";
    default:
      return value || "-";
  }
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

const formatDate = (value?: string) => formatDateTimeSafe(value);
const formatRuleIds = (value?: number[]) =>
  value && value.length > 0 ? value.map((id) => `#${id}`).join(", ") : "-";

const ruleFileBasename = (value?: string) => {
  const normalized = String(value || "")
    .trim()
    .replace(/\\/g, "/");
  return normalized.split("/").pop() || "";
};

const isCRSBlockingEvaluationRule = (rule: WAFRuleMatch) => {
  const filename = ruleFileBasename(rule.file).toLowerCase();
  return (
    filename === "request-949-blocking-evaluation.conf" ||
    filename === "response-959-blocking-evaluation.conf" ||
    rule.tags?.some((tag) => tag.toLowerCase() === "anomaly-evaluation")
  );
};

const getEntrySourceIp = (event: WAFEvent) =>
  event.client_ip || event.remote_addr || "";

const getEntryDisplayIp = (event: WAFEvent) => {
  const sourceIp = getEntrySourceIp(event);
  return normalizeIpKey(sourceIp) || sourceIp || "-";
};

const getEntryIpSnapshot = (event: WAFEvent) =>
  getSnapshot(getEntrySourceIp(event));

const getEntryIpLocation = (event: WAFEvent) =>
  getEntryIpSnapshot(event)?.location || "";

const getEntryIpLocationText = (event: WAFEvent) => {
  const snapshot = getEntryIpSnapshot(event);
  const location = snapshot?.location || "";
  if (location) return location;

  if (snapshot?.status === "queued" || snapshot?.status === "processing") {
    return "属地解析中...";
  }

  if (snapshot?.status === "failed") {
    return "属地暂未获取";
  }

  return "";
};

const hasRuleDescription = (rule: WAFRuleMatch) =>
  Boolean(rule.message?.trim() || rule.data?.trim());

const getPrimaryRule = (event: WAFEvent): WAFRuleMatch | undefined => {
  const rules = event.rules || [];
  const interruptedRuleId = event.interruption?.rule_id;
  const contributingRules = rules.filter(
    (rule) => !isCRSBlockingEvaluationRule(rule),
  );
  if (interruptedRuleId) {
    const interruptedRule = rules.find((rule) => rule.id === interruptedRuleId);
    if (interruptedRule && !isCRSBlockingEvaluationRule(interruptedRule)) {
      return interruptedRule;
    }
  }
  return (
    contributingRules.find(hasRuleDescription) ||
    contributingRules.find((rule) => rule.disruptive) ||
    contributingRules[0] ||
    rules.find(hasRuleDescription) ||
    rules.find((rule) => rule.disruptive) ||
    rules[0]
  );
};

const formatPrimaryRuleId = (event: WAFEvent) => {
  const primaryRule = getPrimaryRule(event);
  if (!primaryRule) return formatRuleIds(event.rule_ids);
  const ruleIds = new Set([
    ...(event.rule_ids || []),
    ...(event.rules || []).map((rule) => rule.id),
  ]);
  const otherCount = Math.max(0, ruleIds.size - 1);
  return otherCount > 0
    ? `#${primaryRule.id} · 另 ${otherCount} 条`
    : `#${primaryRule.id}`;
};

const formatRuleSummary = (event: WAFEvent) => {
  const firstRule = getPrimaryRule(event);
  if (!firstRule) return "";
  return firstRule.message || firstRule.data || "";
};

const formatRuleFilePath = (value?: string) => {
  const normalized = String(value || "")
    .trim()
    .replace(/\\/g, "/");
  if (!normalized) return "";

  const lowerPath = normalized.toLowerCase();
  const lowerPrefix = WAF_RULE_PATH_PREFIX.toLowerCase();
  if (lowerPath === lowerPrefix) return "";
  if (lowerPath.startsWith(`${lowerPrefix}/`)) {
    return normalized.slice(WAF_RULE_PATH_PREFIX.length + 1);
  }

  return normalized;
};

const formatRuleFileLocation = (rule: WAFRuleMatch) => {
  const file = formatRuleFilePath(rule.file);
  if (!file) return "";
  return rule.line ? `${file}:${rule.line}` : file;
};

const formatRuleLocationSummary = (event: WAFEvent) => {
  const firstRule = getPrimaryRule(event);
  if (!firstRule?.file) return "";
  return formatRuleFileLocation(firstRule);
};

const formatRules = (
  value: WAFRuleMatch[] | undefined,
  event?: WAFEvent | null,
) => {
  if (!value || value.length === 0) return "-";
  const primaryRuleId = event ? getPrimaryRule(event)?.id : undefined;
  return [...value]
    .sort((left, right) => {
      if (primaryRuleId) {
        if (left.id === primaryRuleId) return -1;
        if (right.id === primaryRuleId) return 1;
      }
      return 0;
    })
    .map((rule) => {
      const parts = [`#${rule.id}`];
      if (rule.phase) parts.push(`phase ${rule.phase}`);
      if (rule.severity) parts.push(rule.severity);
      const location = formatRuleFileLocation(rule);
      if (location) parts.push(location);
      if (rule.message) parts.push(rule.message);
      return parts.join(" · ");
    })
    .join("\n");
};

const formatInterruption = (value: WAFInterruptionInfo | undefined) => {
  if (!value) return "-";
  return [
    value.rule_id ? `rule ${value.rule_id}` : "",
    value.action || "",
    value.status ? `HTTP ${value.status}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
};

const displayedEntries = computed(() =>
  entries.value.map((entry) => ({
    ...entry,
    ipLocation: getEntryIpLocation(entry),
  })),
);

const activeEventWithIpLocation = computed(() =>
  activeEvent.value
    ? {
        ...activeEvent.value,
        ipLocation: getEntryIpLocation(activeEvent.value),
      }
    : null,
);

const detailFields = [
  { key: "time", label: "时间" },
  { key: "trace_id", label: "Trace ID" },
  { key: "transaction_id", label: "事务 ID" },
  { key: "action", label: "动作" },
  { key: "mode", label: "模式" },
  { key: "status", label: "状态码" },
  { key: "client_ip", label: "客户端 IP" },
  { key: "ipLocation", label: "属地" },
  { key: "remote_addr", label: "远端地址" },
  { key: "method", label: "方法" },
  { key: "scheme", label: "协议" },
  { key: "host", label: "Host" },
  { key: "path", label: "路径" },
  { key: "query", label: "Query" },
  { key: "request_uri", label: "请求地址" },
  { key: "user_agent", label: "User-Agent" },
  { key: "referer", label: "Referer" },
  { key: "route_type", label: "路由类型" },
  { key: "route_key", label: "路由键" },
  { key: "upstream", label: "上游目标" },
  { key: "bundle_id", label: "规则包" },
  { key: "bundle_hash", label: "Bundle Hash" },
  { key: "rule_ids", label: "规则 ID" },
  { key: "rules", label: "规则详情" },
  { key: "interruption", label: "阻断信息" },
  { key: "error", label: "错误" },
] as const;

const detailItems = computed(() =>
  buildDetailFields(activeEventWithIpLocation.value, detailFields, {
    format: (key, value) => {
      if (key === "time") return formatDate(value);
      if (key === "action") return actionLabel(String(value || ""));
      if (key === "mode") return modeLabel(String(value || ""));
      if (key === "route_type") return routeTypeLabel(String(value || ""));
      if (key === "rule_ids") return formatRuleIds(value as number[]);
      if (key === "rules")
        return formatRules(value as WAFRuleMatch[], activeEvent.value);
      if (key === "interruption")
        return formatInterruption(value as WAFInterruptionInfo);
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
  () => route.query.trace_id,
  (value) => {
    const next = String(value || "");
    if (traceFilter.value === next) return;
    traceFilter.value = next;
    resetCursorPagination();
    void fetchEntries({ drain: true });
  },
);

const startAutoRefresh = () => {
  stopAutoRefresh();
  autoRefreshTimer = window.setInterval(() => {
    if (currentCursor.value || cursorHistory.value.length > 0) return;
    void fetchEntries({ silent: true });
  }, AUTO_REFRESH_MS);
};

const stopAutoRefresh = () => {
  if (autoRefreshTimer !== null) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
};

onMounted(async () => {
  if (!configStore.config) {
    await configStore.loadConfig();
  }
  await fetchEntries({ drain: true });
  startAutoRefresh();
});

onBeforeUnmount(() => {
  stopAutoRefresh();
});
</script>

<template>
  <div class="flex h-full flex-col gap-3">
    <div
      class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
    >
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <h1 class="text-lg font-semibold tracking-tight">WAF 日志</h1>
          <span class="text-xs text-muted-foreground">{{ selectedDate }}</span>
        </div>
        <p class="text-sm text-muted-foreground">
          查看 Coraza WAF 命中的规则、动作、Trace ID 和请求上下文。
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <RefreshButton
          :loading="loading"
          :disabled="loading"
          @click="refreshAll"
        />
        <ConfirmDangerPopover
          :title="`确认删除 ${selectedDate} 的 WAF 日志？`"
          description="删除后当天 WAF 事件将不可恢复。"
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
      v-if="!isWAFEnabled"
      class="flex items-center gap-3 rounded-lg border-dashed bg-muted/20 px-4 py-3 text-foreground shadow-none"
    >
      <ShieldAlert class="h-4 w-4 shrink-0 text-muted-foreground" />
      <div
        class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <p class="text-sm text-muted-foreground">
          当前未启用 WAF，仍可查看已持久化的历史事件。
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
        <div class="flex flex-col gap-2 md:flex-row md:items-center">
          <SearchInput
            v-model="searchQuery"
            placeholder="搜索 Trace、Host、路径、IP..."
            class="w-full md:w-[320px] md:max-w-[320px]"
            @search="handleSearch"
          />

          <div class="flex flex-wrap items-center gap-2">
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
          </div>
        </div>

        <div
          class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
        >
          <span>{{ cursorPageLabel }} · {{ entries.length }} 条</span>
          <span v-if="traceFilter.trim()" class="font-mono"
            >Trace：{{ traceFilter.trim() }}</span
          >
          <span v-if="searchQuery.trim()"
            >关键词：{{ searchQuery.trim() }}</span
          >
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        <Table class="min-w-[820px]">
          <TableHeader class="sticky top-0 z-10 bg-background/95 backdrop-blur">
            <TableRow>
              <TableHead
                class="h-10 w-[320px] min-w-[320px] max-w-[320px] text-[11px] font-medium text-muted-foreground"
                >请求</TableHead
              >
              <TableHead
                class="h-10 text-[11px] font-medium text-muted-foreground"
                >来源</TableHead
              >
              <TableHead
                class="h-10 min-w-[220px] text-[11px] font-medium text-muted-foreground"
                >规则</TableHead
              >
              <TableHead
                class="sticky right-0 z-20 h-10 bg-background/95 pr-4 text-right text-[11px] font-medium text-muted-foreground"
                >操作</TableHead
              >
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="loading && entries.length === 0">
              <TableCell
                colspan="4"
                class="py-10 text-center text-muted-foreground"
              >
                加载中...
              </TableCell>
            </TableRow>
            <TableRow v-else-if="entries.length === 0">
              <TableCell
                colspan="4"
                class="py-10 text-center text-muted-foreground"
              >
                暂无 WAF 日志
              </TableCell>
            </TableRow>
            <TableRow
              v-else
              v-for="entry in displayedEntries"
              :key="entry.trace_id"
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
                    <Badge
                      :variant="actionVariant(entry.action)"
                      class="shrink-0"
                    >
                      {{ actionLabel(entry.action) }}
                    </Badge>
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
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="text-[11px] text-muted-foreground">
                      {{ routeTypeLabel(entry.route_type) }}
                    </span>
                    <span class="text-[11px] text-muted-foreground">
                      {{ modeLabel(entry.mode) }}
                    </span>
                    <span
                      v-if="entry.status"
                      class="font-mono text-[11px] text-muted-foreground"
                    >
                      HTTP {{ entry.status }}
                    </span>
                    <span
                      v-if="entry.route_key"
                      class="break-all text-[11px] text-muted-foreground/75"
                    >
                      {{ entry.route_key }}
                    </span>
                  </div>
                </div>
              </TableCell>
              <TableCell class="min-w-[150px] py-2.5">
                <div class="font-mono text-sm text-foreground">
                  {{ getEntryDisplayIp(entry) }}
                </div>
                <div
                  v-if="getEntryIpLocationText(entry)"
                  class="text-[11px] text-muted-foreground"
                >
                  {{ getEntryIpLocationText(entry) }}
                </div>
              </TableCell>
              <TableCell class="py-2.5">
                <div class="font-mono text-xs text-foreground">
                  {{ formatPrimaryRuleId(entry) }}
                </div>
                <div
                  v-if="formatRuleSummary(entry)"
                  class="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground"
                >
                  {{ formatRuleSummary(entry) }}
                </div>
                <div
                  v-if="formatRuleLocationSummary(entry)"
                  class="mt-1 line-clamp-1 break-all font-mono text-[10px] leading-4 text-muted-foreground/75"
                >
                  {{ formatRuleLocationSummary(entry) }}
                </div>
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
                  <SelectItem
                    v-for="option in LIMIT_OPTIONS"
                    :key="option"
                    :value="option"
                  >
                    {{ option }} 条
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>
    </div>

    <DetailDialog
      v-model:open="isDetailsOpen"
      title="WAF 日志详情"
      description="查看此条 WAF 事件的完整字段。"
      max-width-class="sm:max-w-[680px]"
      close-variant="default"
      :copy-text="detailCopyText"
    >
      <div v-if="activeEvent" class="space-y-4">
        <DetailFieldsGrid :items="detailItems" />
      </div>
    </DetailDialog>
  </div>
</template>
