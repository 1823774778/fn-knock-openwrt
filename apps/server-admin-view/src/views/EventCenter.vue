<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Eye, Loader2, Trash2 } from "lucide-vue-next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import RefreshButton from "@/components/RefreshButton.vue";
import SearchInput from "@admin-shared/components/SearchInput.vue";
import ConfirmDangerPopover from "@admin-shared/components/common/ConfirmDangerPopover.vue";
import DetailDialog from "@admin-shared/components/common/DetailDialog.vue";
import DetailFieldsGrid from "@admin-shared/components/common/DetailFieldsGrid.vue";
import HumanFriendlyTime from "@admin-shared/components/common/HumanFriendlyTime.vue";
import TableSkeletonBlock from "@admin-shared/components/list/TableSkeletonBlock.vue";
import PagedTableFooter from "@admin-shared/components/list/PagedTableFooter.vue";
import {
  extractErrorMessage,
  useAsyncAction,
} from "@admin-shared/composables/useAsyncAction";
import { useDelayedLoading } from "@admin-shared/composables/useDelayedLoading";
import { usePagedSelectionList } from "@admin-shared/composables/usePagedSelectionList";
import { buildDetailFields } from "@admin-shared/utils/buildDetailFields";
import { formatDateTimeSafe } from "@admin-shared/utils/formatDateTimeSafe";
import { toast } from "@admin-shared/utils/toast";
import { EventCenterAPI } from "../lib/api";
import type {
  SystemEventLevel,
  SystemEventRecord,
  SystemEventSource,
  SystemEventType,
} from "../types";

const TYPE_OPTIONS: Array<{ value: SystemEventType | "all"; label: string }> = [
  { value: "all", label: "全部事件" },
  { value: "FN_EVENT_AUTH_LOGIN_SUCCESS", label: "登录成功" },
  { value: "FN_EVENT_AUTH_LOGOUT", label: "退出登录" },
  { value: "FN_EVENT_AUTH_LOGIN_FAILURE", label: "登录失败" },
  { value: "FN_EVENT_AUTH_SESSION_IP_DRIFT", label: "会话 IP 漂移" },
  { value: "FN_EVENT_SECURITY_SCANNER_BLOCKED", label: "扫描器拦截" },
  { value: "FN_EVENT_DDNS_UPDATE_COMPLETED", label: "DDNS 更新" },
  { value: "FN_EVENT_GATEWAY_THROTTLE_BLOCKED", label: "网关节流封锁" },
  { value: "FN_EVENT_SYSTEM_CPU_ALERT", label: "CPU 告警" },
  { value: "FN_EVENT_SYSTEM_CPU_RECOVERED", label: "CPU 恢复" },
  { value: "FN_EVENT_SYSTEM_MEMORY_ALERT", label: "内存告警" },
  { value: "FN_EVENT_SYSTEM_MEMORY_RECOVERED", label: "内存恢复" },
];

const LEVEL_OPTIONS: Array<{ value: SystemEventLevel | "all"; label: string }> =
  [
    { value: "all", label: "全部级别" },
    { value: "INFO", label: "信息" },
    { value: "WARN", label: "注意" },
    { value: "ERROR", label: "错误" },
    { value: "CRITICAL", label: "严重" },
  ];

const SOURCE_OPTIONS: Array<{
  value: SystemEventSource | "all";
  label: string;
}> = [
  { value: "all", label: "全部系统" },
  { value: "SERVER_ADMIN", label: "管理后台" },
  { value: "GO_REAUTH_PROXY", label: "认证代理" },
  { value: "SYSTEM_MONITOR", label: "系统监控" },
];

const selectedType = ref<SystemEventType | "all">("all");
const selectedLevel = ref<SystemEventLevel | "all">("all");
const selectedSource = ref<SystemEventSource | "all">("all");
const isDetailsOpen = ref(false);
const activeEvent = ref<SystemEventRecord | null>(null);

const { isPending: isDeleting, run: runDelete } = useAsyncAction({
  onError: (error) => {
    toast.error("删除失败", {
      description: extractErrorMessage(error, "删除事件失败"),
    });
  },
});

const {
  items: events,
  total: totalEvents,
  loading,
  searchQuery,
  currentPage,
  limit,
  parsedLimit,
  selectedKeys,
  isAllSelected,
  fetchList: fetchEvents,
  handleSearch,
  handlePageChange,
  handleLimitChange,
  toggleSelect,
  clearSelection,
} = usePagedSelectionList<SystemEventRecord, string>({
  fetchPage: async ({ page, limit, query }) => {
    const result = await EventCenterAPI.getEvents({
      page,
      limit,
      search: query,
      type: selectedType.value,
      level: selectedLevel.value,
      source: selectedSource.value,
    });

    if (!(result.success || result.data)) {
      throw new Error(result.message || "加载失败");
    }

    return {
      items: result.data.events || [],
      total: result.data.total || 0,
    };
  },
  getKey: (event) => event.id,
  onError: (error) => {
    toast.error("加载失败", {
      description: extractErrorMessage(error, "事件列表加载失败"),
    });
  },
});

const showTableSkeleton = useDelayedLoading(
  () => loading.value && events.value.length === 0,
);
const hasSelectedEvents = computed(() => selectedKeys.value.size > 0);

const viewDetails = (event: SystemEventRecord) => {
  activeEvent.value = event;
  isDetailsOpen.value = true;
};

const formatDate = (value: string) => formatDateTimeSafe(value);

const deleteEvents = async (ids: string[]) => {
  await runDelete(() => EventCenterAPI.deleteEvents(ids), {
    onSuccess: async (result) => {
      if (result.success || result.message === "success") {
        toast.success("删除成功");
        clearSelection();
        await fetchEvents();
        return;
      }
      toast.error("删除失败", {
        description: result.message || "删除事件失败",
      });
    },
  });
};

const handleFilterChange = () => {
  currentPage.value = 1;
  fetchEvents();
};

watch([selectedType, selectedLevel, selectedSource], handleFilterChange);

const detailFieldDefinitions = [
  { key: "id", label: "事件 ID" },
  { key: "type", label: "事件" },
  { key: "level", label: "级别" },
  { key: "source", label: "系统" },
  { key: "happened_at", label: "发生时间" },
  { key: "dedupe_key", label: "去重键" },
  { key: "subject", label: "主题" },
  { key: "credential_name", label: "凭证名称" },
  { key: "credential_id", label: "凭证 ID" },
  { key: "auth_method", label: "认证方式" },
  { key: "grant_type", label: "授权方式" },
  { key: "post_login_ip_grant_mode", label: "登录后 IP 放行" },
  { key: "remember_me", label: "记住我" },
  { key: "session_id", label: "会话 ID" },
  { key: "ip", label: "IP 地址" },
  { key: "ip_location", label: "IP 归属地" },
  { key: "user_agent", label: "User-Agent" },
  { key: "expires_at", label: "过期时间" },
  { key: "login_time", label: "登录时间" },
  { key: "logout_source", label: "退出来源" },
  { key: "attempts", label: "失败次数" },
  { key: "threshold", label: "阈值" },
  { key: "retry_after_seconds", label: "重试等待（秒）" },
  { key: "blocked_until", label: "封禁截止时间" },
  { key: "method", label: "失败方式" },
  { key: "drift_source", label: "漂移来源" },
  { key: "from_ip", label: "原 IP" },
  { key: "from_ip_location", label: "原 IP 归属地" },
  { key: "to_ip", label: "当前 IP" },
  { key: "to_ip_location", label: "当前 IP 归属地" },
  { key: "blocked_at", label: "拦截时间" },
  { key: "window_minutes", label: "统计窗口（分钟）" },
  { key: "hit_count", label: "命中次数" },
  { key: "provider", label: "服务商" },
  { key: "success", label: "结果" },
  { key: "message", label: "消息" },
  { key: "update_scope", label: "更新范围" },
  { key: "ip_source", label: "IP 来源" },
  { key: "previous_ipv4", label: "原 IPv4" },
  { key: "next_ipv4", label: "当前 IPv4" },
  { key: "previous_ipv6", label: "原 IPv6" },
  { key: "next_ipv6", label: "当前 IPv6" },
  { key: "block_seconds", label: "封锁时长（秒）" },
  { key: "requests_per_second", label: "每秒请求数" },
  { key: "burst", label: "突发容量" },
  { key: "route_type", label: "路由类型" },
  { key: "host", label: "Host" },
  { key: "path", label: "路径" },
  { key: "is_auth_route", label: "鉴权路由" },
  { key: "hostname", label: "主机名" },
  { key: "usage_percent", label: "使用率" },
  { key: "threshold_percent", label: "告警阈值" },
  { key: "recover_percent", label: "恢复阈值" },
  { key: "sample_interval_seconds", label: "采样间隔（秒）" },
  { key: "sustain_seconds", label: "持续时长（秒）" },
] as const;

const formatEventTypeLabel = (type: SystemEventType) =>
  TYPE_OPTIONS.find((option) => option.value === type)?.label || type;

const LEVEL_LABELS: Record<SystemEventLevel, string> = {
  INFO: "信息",
  WARN: "注意",
  ERROR: "错误",
  CRITICAL: "严重",
};

const formatLevelLabel = (level: SystemEventLevel) =>
  LEVEL_LABELS[level] || level;

const formatSourceLabel = (source: SystemEventSource) =>
  SOURCE_OPTIONS.find((option) => option.value === source)?.label || source;

const SUBJECT_KIND_LABELS: Record<
  NonNullable<SystemEventRecord["subject"]>["kind"],
  string
> = {
  IP: "IP",
  SESSION: "会话",
  DDNS: "DDNS",
  RESOURCE: "资源",
};

const LOGOUT_SOURCE_LABELS: Record<string, string> = {
  user_logout: "用户主动退出",
  admin_session_delete: "管理员删除会话",
};

const DRIFT_SOURCE_LABELS: Record<string, string> = {
  "proxy-session": "代理会话",
  "fnos-token": "飞牛指纹续接",
  "session-refresh": "会话刷新",
  "browser-session": "浏览器会话",
};

const GRANT_TYPE_LABELS: Record<string, string> = {
  browser_session: "浏览器会话",
  login_ip_grant: "登录 IP 放行",
};

const POST_LOGIN_IP_GRANT_MODE_LABELS: Record<string, string> = {
  follow_session: "跟随会话",
  disabled: "禁用",
  custom: "自定义",
};

const UPDATE_SCOPE_LABELS: Record<string, string> = {
  dual_stack: "双栈",
  ipv4_only: "仅 IPv4",
  ipv6_only: "仅 IPv6",
};

const IP_SOURCE_LABELS: Record<string, string> = {
  public: "公网 IP",
  interface: "网卡地址",
};

const formatSubject = (
  subject: SystemEventRecord["subject"] | undefined,
  shortenId = false,
) => {
  if (!subject) return "-";
  const kind = SUBJECT_KIND_LABELS[subject.kind] || subject.kind;
  const id = shortenId ? shortId(subject.id, 18) : subject.id;
  return `${kind} · ${id}`;
};

const shortenMiddle = (value: string, leading = 12, trailing = 10) =>
  value.length <= leading + trailing + 3
    ? value
    : `${value.slice(0, leading)}...${value.slice(-trailing)}`;

const formatIpDisplay = (value: unknown) => {
  const ip = String(value ?? "").trim();

  if (!ip) return "-";
  if (ip.includes(":") && ip.length > 24) {
    return shortenMiddle(ip, 14, 11);
  }
  if (ip.length > 24) {
    return shortenMiddle(ip, 12, 8);
  }
  return ip;
};

const formatPercentage = (value: unknown) =>
  value === undefined || value === null || value === ""
    ? "-"
    : `${String(value)}%`;

const formatBoolean = (value: unknown) =>
  value === undefined || value === null ? "-" : value ? "是" : "否";

const detailItems = computed(() => {
  const event = activeEvent.value;
  if (!event) return [];

  const payload = event.payload ?? {};
  const detailRecord: Record<string, unknown> = {
    id: event.id,
    type: event.type,
    level: event.level,
    source: event.source,
    happened_at: event.happened_at,
    dedupe_key: event.dedupe_key,
    subject: event.subject,
    ...payload,
  };

  return buildDetailFields(detailRecord, detailFieldDefinitions, {
    format: (key, value) => {
      if (key === "type") return formatEventTypeLabel(value as SystemEventType);
      if (key === "level") return formatLevelLabel(value as SystemEventLevel);
      if (key === "source")
        return formatSourceLabel(value as SystemEventSource);
      if (
        key === "happened_at" ||
        key === "expires_at" ||
        key === "login_time" ||
        key === "blocked_until" ||
        key === "blocked_at"
      ) {
        return formatDate(String(value || ""));
      }
      if (key === "subject") return formatSubject(event.subject, false);
      if (key === "logout_source")
        return LOGOUT_SOURCE_LABELS[String(value)] || String(value);
      if (key === "drift_source")
        return DRIFT_SOURCE_LABELS[String(value)] || String(value);
      if (key === "grant_type")
        return GRANT_TYPE_LABELS[String(value)] || String(value);
      if (key === "post_login_ip_grant_mode")
        return POST_LOGIN_IP_GRANT_MODE_LABELS[String(value)] || String(value);
      if (key === "update_scope")
        return UPDATE_SCOPE_LABELS[String(value)] || String(value);
      if (key === "ip_source")
        return IP_SOURCE_LABELS[String(value)] || String(value);
      if (key === "remember_me" || key === "is_auth_route")
        return formatBoolean(value);
      if (key === "success")
        return value === undefined || value === null
          ? "-"
          : value
            ? "成功"
            : "失败";
      if (
        key === "usage_percent" ||
        key === "threshold_percent" ||
        key === "recover_percent"
      ) {
        return formatPercentage(value);
      }
      if (value === undefined || value === null || value === "") return "-";
      return String(value);
    },
  });
});

const levelBadgeClass = (level: SystemEventLevel) => {
  switch (level) {
    case "INFO":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700";
    case "WARN":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700";
    case "ERROR":
      return "border-rose-500/25 bg-rose-500/10 text-rose-700";
    case "CRITICAL":
      return "border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-700";
    default:
      return "";
  }
};

const shortId = (value: string, size = 10) =>
  value.length <= size
    ? value
    : `${value.slice(0, Math.max(4, size - 5))}...${value.slice(-4)}`;

type EventOriginDisplay = {
  key: string;
  ip: string;
  location?: string;
};

const resolveEventOrigins = (
  event: SystemEventRecord,
): EventOriginDisplay[] => {
  const payload = event.payload ?? {};
  const origins: EventOriginDisplay[] = [];

  const pushOrigin = (ipKey: string, locationKey: string) => {
    const ip = String(payload[ipKey] ?? "").trim();
    if (!ip) return;

    const location = String(payload[locationKey] ?? "").trim();
    origins.push({
      key: `${ipKey}:${ip}`,
      ip,
      ...(location ? { location } : {}),
    });
  };

  switch (event.type) {
    case "FN_EVENT_AUTH_SESSION_IP_DRIFT":
      pushOrigin("to_ip", "to_ip_location");
      if (origins.length === 0) {
        pushOrigin("from_ip", "from_ip_location");
      }
      break;
    default:
      pushOrigin("ip", "ip_location");
      break;
  }

  return origins;
};

const describeEvent = (event: SystemEventRecord) => {
  const payload = event.payload ?? {};

  switch (event.type) {
    case "FN_EVENT_AUTH_LOGIN_SUCCESS":
      return `${String(payload.credential_name || "未知凭证")} 通过 ${String(
        payload.auth_method || "-",
      )} 登录，来源 IP ${formatIpDisplay(payload.ip)}`;
    case "FN_EVENT_AUTH_LOGOUT":
      return `${String(payload.credential_name || "未知凭证")} 已退出登录，来源 ${
        LOGOUT_SOURCE_LABELS[String(payload.logout_source)] ||
        String(payload.logout_source || "-")
      }，会话 IP ${formatIpDisplay(payload.ip)}`;
    case "FN_EVENT_AUTH_LOGIN_FAILURE": {
      const attempts = String(payload.attempts || "-");
      const retryAfterSeconds = Number(payload.retry_after_seconds);
      return `IP ${formatIpDisplay(payload.ip)} 在 1 小时内第 ${attempts} 次失败${
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? `，需等待 ${retryAfterSeconds} 秒后重试`
          : ""
      }`;
    }
    case "FN_EVENT_AUTH_SESSION_IP_DRIFT":
      return `会话 ${shortId(String(payload.session_id || ""), 14)} 从 ${String(
        formatIpDisplay(payload.from_ip),
      )} 漂移到 ${String(formatIpDisplay(payload.to_ip))}`;
    case "FN_EVENT_SECURITY_SCANNER_BLOCKED":
      return `${formatIpDisplay(payload.ip)} 因非常规路径命中 ${String(
        payload.hit_count || "-",
      )} 次被拦截`;
    case "FN_EVENT_DDNS_UPDATE_COMPLETED":
      return `${String(payload.provider || "-")} ${
        Boolean(payload.success) ? "更新成功" : "更新失败"
      }：${String(payload.message || "-")}`;
    case "FN_EVENT_GATEWAY_THROTTLE_BLOCKED":
      return `${formatIpDisplay(payload.ip)} 触发节流封锁 ${String(
        payload.block_seconds || "-",
      )} 秒`;
    case "FN_EVENT_SYSTEM_CPU_ALERT":
      return `${String(payload.hostname || "-")} CPU 使用率 ${String(
        payload.usage_percent || "-",
      )}%`;
    case "FN_EVENT_SYSTEM_CPU_RECOVERED":
      return `${String(payload.hostname || "-")} CPU 已恢复到 ${String(
        payload.usage_percent || "-",
      )}%`;
    case "FN_EVENT_SYSTEM_MEMORY_ALERT":
      return `${String(payload.hostname || "-")} 内存使用率 ${String(
        payload.usage_percent || "-",
      )}%`;
    case "FN_EVENT_SYSTEM_MEMORY_RECOVERED":
      return `${String(payload.hostname || "-")} 内存已恢复到 ${String(
        payload.usage_percent || "-",
      )}%`;
    default:
      return JSON.stringify(payload);
  }
};

onMounted(() => {
  fetchEvents();
});
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="space-y-1">
      <div class="text-xl font-semibold tracking-tight text-foreground">
        事件中心
      </div>
      <div class="text-sm leading-6 text-muted-foreground">
        统一查看登录成功、退出登录、登录失败、IP 漂移、扫描器拦截、DDNS
        更新和网关节流等系统事件。
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <SearchInput
        v-model="searchQuery"
        placeholder="搜索事件 ID、IP、会话、凭证..."
        class="w-full max-w-xs"
        @search="handleSearch"
      />

      <Select v-model="selectedType">
        <SelectTrigger class="w-[160px]">
          <SelectValue placeholder="事件类型" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="option in TYPE_OPTIONS"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </SelectItem>
        </SelectContent>
      </Select>

      <Select v-model="selectedLevel">
        <SelectTrigger class="w-[140px]">
          <SelectValue placeholder="级别" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="option in LEVEL_OPTIONS"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </SelectItem>
        </SelectContent>
      </Select>

      <Select v-model="selectedSource">
        <SelectTrigger class="w-[110px]">
          <SelectValue placeholder="系统" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="option in SOURCE_OPTIONS"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </SelectItem>
        </SelectContent>
      </Select>

      <div class="ml-auto flex items-center gap-2">
        <RefreshButton
          :loading="loading"
          :disabled="loading"
          @click="fetchEvents"
        />

        <ConfirmDangerPopover
          v-if="hasSelectedEvents"
          :title="`确认删除 ${selectedKeys.size} 条事件？`"
          description="删除后记录将无法恢复。"
          :loading="isDeleting"
          :disabled="isDeleting"
          :on-confirm="() => deleteEvents(Array.from(selectedKeys))"
        >
          <template #trigger>
            <Button variant="destructive" :disabled="isDeleting">
              <Trash2 class="mr-2 h-4 w-4" />
              删除已选 ({{ selectedKeys.size }})
            </Button>
          </template>
        </ConfirmDangerPopover>
      </div>
    </div>

    <div
      class="flex flex-1 flex-col overflow-hidden rounded-md border bg-background"
    >
      <div class="flex-1 overflow-auto">
        <Table
          v-if="!(loading && events.length === 0)"
          class="table-fixed min-w-[980px]"
        >
          <TableHeader class="sticky top-0 z-10 bg-background shadow-sm">
            <TableRow>
              <TableHead class="w-[42px] pl-3 pr-1">
                <Checkbox v-model="isAllSelected" />
              </TableHead>
              <TableHead class="w-[300px]">事件</TableHead>
              <TableHead class="w-[220px]">来源</TableHead>
              <TableHead class="w-[100px]">级别</TableHead>
              <TableHead class="w-[96px]">系统</TableHead>
              <TableHead class="w-[110px] pr-6 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="loading">
              <TableCell colspan="6" class="py-10 text-center">
                <Loader2
                  class="mx-auto h-6 w-6 animate-spin text-muted-foreground"
                />
              </TableCell>
            </TableRow>
            <TableRow v-else-if="events.length === 0">
              <TableCell
                colspan="6"
                class="py-10 text-center text-muted-foreground"
              >
                暂无事件
              </TableCell>
            </TableRow>
            <TableRow v-for="event in events" :key="event.id">
              <TableCell class="w-[42px] pl-3 pr-1 align-top">
                <Checkbox
                  :model-value="selectedKeys.has(event.id)"
                  @update:model-value="toggleSelect(event.id)"
                />
              </TableCell>
              <TableCell class="w-[340px] max-w-[340px] align-top">
                <div class="space-y-1.5">
                  <div class="flex items-start gap-2">
                    <div
                      class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium leading-5 text-muted-foreground"
                    >
                      <HumanFriendlyTime :value="event.happened_at" />
                    </div>
                    <div
                      class="min-w-0 text-sm font-semibold leading-6 text-foreground"
                    >
                      {{ formatEventTypeLabel(event.type) }}
                    </div>
                  </div>
                </div>
                <div
                  class="mt-1 max-w-[300px] line-clamp-3 whitespace-normal break-words text-sm leading-6 text-muted-foreground"
                >
                  {{ describeEvent(event) }}
                </div>
              </TableCell>
              <TableCell class="align-middle">
                <div
                  v-if="resolveEventOrigins(event).length === 0"
                  class="text-sm text-muted-foreground"
                >
                  -
                </div>
                <div v-else class="space-y-1">
                  <div
                    v-for="origin in resolveEventOrigins(event)"
                    :key="origin.key"
                    class="space-y-0.5 leading-5"
                  >
                    <div
                      class="font-mono text-xs text-foreground"
                      :title="origin.ip"
                    >
                      {{ formatIpDisplay(origin.ip) }}
                    </div>
                    <div
                      v-if="origin.location"
                      class="line-clamp-2 whitespace-normal text-xs leading-5 text-muted-foreground"
                    >
                      {{ origin.location }}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  class="border px-2 py-0.5"
                  :class="levelBadgeClass(event.level)"
                >
                  {{ formatLevelLabel(event.level) }}
                </Badge>
              </TableCell>
              <TableCell class="truncate align-middle">
                {{ formatSourceLabel(event.source) }}
              </TableCell>
              <TableCell class="space-x-2 pr-6 text-right">
                <Button variant="ghost" size="icon" @click="viewDetails(event)">
                  <Eye class="h-4 w-4" />
                </Button>
                <ConfirmDangerPopover
                  title="确认删除该事件？"
                  description="删除后记录将无法恢复。"
                  :loading="isDeleting"
                  :disabled="isDeleting"
                  :on-confirm="() => deleteEvents([event.id])"
                >
                  <template #trigger>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="text-destructive"
                      :disabled="isDeleting"
                    >
                      <Trash2 class="h-4 w-4" />
                    </Button>
                  </template>
                </ConfirmDangerPopover>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <TableSkeletonBlock
          v-else-if="showTableSkeleton"
          :header-widths="['w-16', 'w-52', 'w-24', 'w-12', 'w-16', 'w-10']"
          :row-widths="['w-16', 'w-56', 'w-28', 'w-12', 'w-20', 'w-10']"
        />

        <div v-else class="h-[420px]" aria-hidden="true"></div>
      </div>

      <PagedTableFooter
        :total="totalEvents"
        :page="currentPage"
        :limit="limit"
        :items-per-page="parsedLimit"
        total-text="条事件"
        @update:page="handlePageChange"
        @update:limit="handleLimitChange"
      />
    </div>

    <DetailDialog
      v-model:open="isDetailsOpen"
      title="事件详情"
      description="查看事件基础信息与上下文字段。"
      max-width-class="sm:max-w-[760px]"
      close-variant="default"
    >
      <div v-if="activeEvent" class="space-y-6">
        <DetailFieldsGrid :items="detailItems" />

        <div v-if="activeEvent.tags?.length" class="space-y-2">
          <div class="text-sm font-medium text-foreground">标签</div>
          <div class="flex flex-wrap gap-2">
            <Badge
              v-for="tag in activeEvent.tags"
              :key="tag"
              variant="secondary"
              class="rounded-full px-2 py-0.5"
            >
              {{ tag }}
            </Badge>
          </div>
        </div>
      </div>
    </DetailDialog>
  </div>
</template>
