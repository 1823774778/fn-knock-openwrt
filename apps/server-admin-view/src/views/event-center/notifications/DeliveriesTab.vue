<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Eye, Loader2, Trash2 } from "lucide-vue-next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import RefreshButton from "@/components/RefreshButton.vue";
import ConfirmDangerPopover from "@admin-shared/components/common/ConfirmDangerPopover.vue";
import DetailDialog from "@admin-shared/components/common/DetailDialog.vue";
import HumanFriendlyTime from "@admin-shared/components/common/HumanFriendlyTime.vue";
import PagedTableFooter from "@admin-shared/components/list/PagedTableFooter.vue";
import { toast } from "@admin-shared/utils/toast";
import { EventCenterAPI } from "../../../lib/api";
import type {
  NotificationDelivery,
  NotificationDeliveryStatus,
  NotificationProviderView,
  NotificationRule,
} from "../../../types";
import { formatDeliveryStatusLabel } from "../constants";

const props = withDefaults(
  defineProps<{
    active?: boolean;
  }>(),
  {
    active: false,
  },
);

const deliveries = ref<NotificationDelivery[]>([]);
const providers = ref<NotificationProviderView[]>([]);
const rules = ref<NotificationRule[]>([]);
const loading = ref(false);
const currentPage = ref(1);
const limit = ref("20");
const total = ref(0);
const activeDelivery = ref<NotificationDelivery | null>(null);
const detailsOpen = ref(false);
const clearing = ref(false);

const parsedLimit = computed(() => Number.parseInt(limit.value, 10) || 20);

const clearDialogDescription = computed(() => {
  return `将删除全部 ${total.value} 条投递记录。已产生的规则和事件不会受影响，但这些投递历史无法恢复。`;
});

const loadData = async () => {
  loading.value = true;
  try {
    const [providersResult, rulesResult, deliveriesResult] = await Promise.all([
      EventCenterAPI.getNotificationProviders(),
      EventCenterAPI.getNotificationRules(),
      EventCenterAPI.getNotificationDeliveries({
        page: currentPage.value,
        limit: parsedLimit.value,
      }),
    ]);

    if (!providersResult.success) {
      throw new Error(providersResult.message || "加载提供商列表失败");
    }
    if (!rulesResult.success) {
      throw new Error(rulesResult.message || "加载规则列表失败");
    }
    if (!deliveriesResult.success) {
      throw new Error(deliveriesResult.message || "加载投递记录失败");
    }

    providers.value = providersResult.data.providers || [];
    rules.value = rulesResult.data.rules || [];
    deliveries.value = deliveriesResult.data.deliveries || [];
    total.value = deliveriesResult.data.total || 0;
  } catch (error) {
    toast.error("加载通知记录失败", {
      description: error instanceof Error ? error.message : "请稍后重试",
    });
  } finally {
    loading.value = false;
  }
};

const statusBadgeClass = (status: NotificationDeliveryStatus) => {
  switch (status) {
    case "success":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700";
    case "failed":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700";
    case "gave_up":
      return "border-rose-500/25 bg-rose-500/10 text-rose-700";
    case "queued":
    case "sending":
      return "border-sky-500/25 bg-sky-500/10 text-sky-700";
    case "skipped":
      return "border-muted-foreground/20 bg-muted text-muted-foreground";
    default:
      return "";
  }
};

const resolveRuleName = (ruleId: string) =>
  rules.value.find((rule) => rule.id === ruleId)?.name || ruleId;

const resolveProviderName = (providerId: string) =>
  providers.value.find((provider) => provider.id === providerId)?.name ||
  providerId;

const openDetails = (delivery: NotificationDelivery) => {
  activeDelivery.value = delivery;
  detailsOpen.value = true;
};

const formatCopyValue = (value: unknown) => {
  const text = String(value ?? "").trim();
  return text || "-";
};

const formatJsonCopyBlock = (value: unknown) =>
  JSON.stringify(value || {}, null, 2);

const detailCopyText = computed(() => {
  const delivery = activeDelivery.value;
  if (!delivery) return "";

  return [
    "基础信息",
    `规则：${resolveRuleName(delivery.rule_id)}`,
    `提供商：${resolveProviderName(delivery.provider_id)}`,
    `状态：${formatDeliveryStatusLabel(delivery.status)}`,
    `尝试次数：${delivery.attempt_count}`,
    `触发时间：${formatCopyValue(delivery.triggered_at)}`,
    `发送时间：${formatCopyValue(delivery.sent_at)}`,
    `下次重试：${formatCopyValue(delivery.next_retry_at)}`,
    `原因：${formatCopyValue(delivery.reason)}`,
    "",
    "消息快照",
    `标题：${formatCopyValue(delivery.message_snapshot.title)}`,
    `摘要：${formatCopyValue(delivery.message_snapshot.summary)}`,
    "正文：",
    formatCopyValue(delivery.message_snapshot.body_text),
    "",
    "请求摘要",
    formatJsonCopyBlock(delivery.request_summary),
    "",
    "响应摘要",
    formatJsonCopyBlock(delivery.response_summary),
  ].join("\n");
});

const clearDeliveries = async () => {
  if (total.value === 0) {
    return;
  }

  clearing.value = true;
  try {
    const result = await EventCenterAPI.clearNotificationDeliveries({});

    if (!result.success) {
      throw new Error(result.message || "清空投递记录失败");
    }

    const deletedCount = result.data.deleted_count || 0;
    toast.success(
      deletedCount > 0
        ? `已清空 ${deletedCount} 条投递记录`
        : "没有可清空的投递记录",
    );
    activeDelivery.value = null;
    detailsOpen.value = false;

    if (currentPage.value !== 1) {
      currentPage.value = 1;
      return;
    }

    await loadData();
  } catch (error) {
    toast.error("清空投递记录失败", {
      description: error instanceof Error ? error.message : "请稍后重试",
    });
  } finally {
    clearing.value = false;
  }
};

watch([currentPage, limit], () => {
  if (!props.active) return;
  void loadData();
});

watch(
  () => props.active,
  (active) => {
    if (!active) return;
    void loadData();
  },
  { immediate: true },
);
</script>

<template>
  <div class="space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap items-center gap-2">
      <div class="text-sm text-muted-foreground">
        展示全部投递记录，可查看详情或一键清空历史。
      </div>

      <div class="ml-auto flex items-center gap-2">
        <ConfirmDangerPopover
          title="确认清空全部投递记录？"
          :description="clearDialogDescription"
          confirm-text="确认清空"
          :loading="clearing"
          :disabled="loading || clearing || total === 0"
          content-class="w-80 text-left"
          :on-confirm="clearDeliveries"
        >
          <template #trigger>
            <Button
              variant="outline"
              class="border-destructive/20 text-destructive hover:bg-destructive/5 hover:text-destructive"
              :disabled="loading || clearing || total === 0"
            >
              <Trash2 class="mr-2 h-4 w-4" />
              清空记录
            </Button>
          </template>
        </ConfirmDangerPopover>

        <RefreshButton
          :loading="loading"
          :disabled="loading || clearing"
          @click="loadData"
        />
      </div>
    </div>

    <div class="overflow-hidden rounded-md border bg-background">
      <div class="overflow-auto">
        <Table class="min-w-[980px]">
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>规则</TableHead>
              <TableHead>提供商</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>消息</TableHead>
              <TableHead>尝试次数</TableHead>
              <TableHead class="w-[110px] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="loading && deliveries.length === 0">
              <TableCell colspan="7" class="py-10 text-center">
                <Loader2 class="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
              </TableCell>
            </TableRow>
            <TableRow v-else-if="deliveries.length === 0">
              <TableCell colspan="7" class="py-10 text-center text-muted-foreground">
                暂无投递记录
              </TableCell>
            </TableRow>
            <TableRow v-for="delivery in deliveries" :key="delivery.id">
              <TableCell class="text-sm text-muted-foreground">
                <HumanFriendlyTime :value="delivery.triggered_at" />
              </TableCell>
              <TableCell>{{ resolveRuleName(delivery.rule_id) }}</TableCell>
              <TableCell>{{ resolveProviderName(delivery.provider_id) }}</TableCell>
              <TableCell>
                <Badge variant="outline" :class="statusBadgeClass(delivery.status)">
                  {{ formatDeliveryStatusLabel(delivery.status) }}
                </Badge>
              </TableCell>
              <TableCell class="max-w-[380px]">
                <div class="space-y-1">
                  <div class="line-clamp-1 font-medium">
                    {{ delivery.message_snapshot.title }}
                  </div>
                  <div class="line-clamp-2 text-xs text-muted-foreground">
                    {{ delivery.message_snapshot.summary }}
                  </div>
                  <div
                    v-if="delivery.reason"
                    class="line-clamp-2 text-xs text-amber-700"
                  >
                    {{ delivery.reason }}
                  </div>
                </div>
              </TableCell>
              <TableCell>{{ delivery.attempt_count }}</TableCell>
              <TableCell class="text-right">
                <Button
                  variant="ghost"
                  size="icon"
                  :disabled="clearing"
                  @click="openDetails(delivery)"
                >
                  <Eye class="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <PagedTableFooter
        :total="total"
        :page="currentPage"
        :limit="limit"
        :items-per-page="parsedLimit"
        total-text="条记录"
        @update:page="(value) => (currentPage = value)"
        @update:limit="(value) => (limit = value)"
      />
    </div>
  </div>

  <DetailDialog
    v-model:open="detailsOpen"
    title="投递详情"
    description="查看这次 fan-out 生成的具体投递快照。"
    max-width-class="sm:max-w-[860px]"
    :copy-text="detailCopyText"
  >
    <div v-if="activeDelivery" class="space-y-5">
      <div class="grid gap-4 md:grid-cols-2">
        <div class="rounded-md border p-4">
          <div class="mb-2 text-sm font-medium">基础信息</div>
          <div class="space-y-1 text-sm">
            <div>规则：{{ resolveRuleName(activeDelivery.rule_id) }}</div>
            <div>
              提供商：{{ resolveProviderName(activeDelivery.provider_id) }}
            </div>
            <div>
              状态：{{ formatDeliveryStatusLabel(activeDelivery.status) }}
            </div>
            <div>尝试次数：{{ activeDelivery.attempt_count }}</div>
            <div>触发时间：{{ activeDelivery.triggered_at }}</div>
            <div v-if="activeDelivery.sent_at">
              发送时间：{{ activeDelivery.sent_at }}
            </div>
            <div v-if="activeDelivery.next_retry_at">
              下次重试：{{ activeDelivery.next_retry_at }}
            </div>
            <div v-if="activeDelivery.reason">
              原因：{{ activeDelivery.reason }}
            </div>
          </div>
        </div>

        <div class="rounded-md border p-4">
          <div class="mb-2 text-sm font-medium">消息快照</div>
          <div class="space-y-2 text-sm">
            <div class="font-medium">
              {{ activeDelivery.message_snapshot.title }}
            </div>
            <div class="text-muted-foreground">
              {{ activeDelivery.message_snapshot.summary }}
            </div>
            <pre
              class="max-h-[220px] overflow-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap"
              >{{ activeDelivery.message_snapshot.body_text }}</pre
            >
          </div>
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <div class="rounded-md border p-4">
          <div class="mb-2 text-sm font-medium">请求摘要</div>
          <pre
            class="max-h-[220px] overflow-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap"
            >{{
              JSON.stringify(activeDelivery.request_summary || {}, null, 2)
            }}</pre
          >
        </div>

        <div class="rounded-md border p-4">
          <div class="mb-2 text-sm font-medium">响应摘要</div>
          <pre
            class="max-h-[220px] overflow-auto rounded bg-muted p-3 text-xs whitespace-pre-wrap"
            >{{
              JSON.stringify(activeDelivery.response_summary || {}, null, 2)
            }}</pre
          >
        </div>
      </div>
    </div>
  </DetailDialog>
</template>
