<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChevronDown, Loader2, Pencil, Plus, Trash2 } from "lucide-vue-next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import HumanFriendlyTime from "@admin-shared/components/common/HumanFriendlyTime.vue";
import ConfirmDangerPopover from "@admin-shared/components/common/ConfirmDangerPopover.vue";
import { toast } from "@admin-shared/utils/toast";
import { EventCenterAPI } from "../../../lib/api";
import type {
  NotificationDeliveryPolicy,
  NotificationGroupBy,
  NotificationProviderDefinition,
  NotificationProviderView,
  NotificationRule,
  NotificationTemplate,
  NotificationTemplateOverrideMode,
  SystemEventType,
} from "../../../types";
import {
  DEFAULT_GROUP_BY_BY_EVENT_TYPE,
  NOTIFICATION_GROUP_BY_OPTIONS,
  SYSTEM_EVENT_TYPE_OPTIONS,
  formatNotificationGroupByLabel,
  formatSystemEventTypeLabel,
} from "../constants";
import SchemaFieldsEditor from "./SchemaFieldsEditor.vue";
import { buildSchemaPayload, createEditableSchemaRecord } from "./form-utils";

type EditableRuleTarget = {
  id?: string;
  provider_id: string;
  target_config: Record<string, unknown>;
  delivery_policy: {
    timeout_seconds: string;
    max_attempts: string;
    backoff_seconds: string;
  };
  template_override_mode: NotificationTemplateOverrideMode;
  template_override: NotificationTemplate | null;
};

type EditableRuleForm = {
  event_types: SystemEventType[];
  window_seconds: string;
  threshold_count: string;
  group_by: NotificationGroupBy | "auto";
  cooldown_seconds: string;
  targets: EditableRuleTarget[];
};

const props = withDefaults(
  defineProps<{
    active?: boolean;
  }>(),
  {
    active: false,
  },
);

const catalog = ref<NotificationProviderDefinition[]>([]);
const providers = ref<NotificationProviderView[]>([]);
const rules = ref<NotificationRule[]>([]);
const loading = ref(false);
const dialogOpen = ref(false);
const dialogMode = ref<"create" | "edit">("create");
const saving = ref(false);
const deletingId = ref<string | null>(null);
const clearAllDialogOpen = ref(false);
const clearingAll = ref(false);
const editingRule = ref<NotificationRule | null>(null);

const allEventTypes = SYSTEM_EVENT_TYPE_OPTIONS.map(
  (option) => option.value,
) as SystemEventType[];
const DEFAULT_RULE_WINDOW_SECONDS = "60";
const DEFAULT_RULE_COOLDOWN_SECONDS = "60";
const createEmptyDeliveryPolicy = () => ({
  timeout_seconds: "",
  max_attempts: "",
  backoff_seconds: "",
});

const ruleForm = ref<EditableRuleForm>({
  event_types: [...allEventTypes],
  window_seconds: DEFAULT_RULE_WINDOW_SECONDS,
  threshold_count: "1",
  group_by: "auto",
  cooldown_seconds: DEFAULT_RULE_COOLDOWN_SECONDS,
  targets: [],
});

const hasProviders = computed(() => providers.value.length > 0);
const isEditMode = computed(() => dialogMode.value === "edit");
const usedEventTypes = computed(
  () => new Set(rules.value.map((rule) => rule.event_type)),
);
const availableEventTypeOptions = computed(() =>
  SYSTEM_EVENT_TYPE_OPTIONS.filter(
    (option) => !usedEventTypes.value.has(option.value),
  ),
);
const availableEventTypes = computed(() =>
  availableEventTypeOptions.value.map((option) => option.value),
);
const hasAvailableEventTypes = computed(
  () => availableEventTypes.value.length > 0,
);
const selectedTargetProviderIds = computed(
  () =>
    new Set(
      ruleForm.value.targets
        .map((target) => target.provider_id)
        .filter((providerId) => Boolean(providerId)),
    ),
);
const availableProvidersForAdd = computed(() =>
  providers.value.filter(
    (provider) => !selectedTargetProviderIds.value.has(provider.id),
  ),
);
const hasAvailableProvidersForAdd = computed(
  () => availableProvidersForAdd.value.length > 0,
);

const selectedEventTypeCount = computed(
  () => ruleForm.value.event_types.length,
);

const isAllEventTypesSelected = computed(
  () =>
    availableEventTypes.value.length > 0 &&
    selectedEventTypeCount.value === availableEventTypes.value.length,
);

const buildRuleDisplayName = (eventType: SystemEventType) =>
  `${formatSystemEventTypeLabel(eventType)} 通知`;

const dialogTitleText = computed(() =>
  isEditMode.value ? "编辑通知规则" : "新增通知规则",
);

const dialogDescriptionText = computed(() =>
  isEditMode.value
    ? "当前规则只对应单个事件，可直接调整触发条件和通知目标。"
    : "只会列出还没有规则的事件，触发条件会先使用默认值，创建后再逐条调整。",
);

const lockedEventTypeLabel = computed(() => {
  const eventType = ruleForm.value.event_types[0];
  return eventType ? formatSystemEventTypeLabel(eventType) : "未选择事件";
});

const dialogModeBadgeLabel = computed(() =>
  isEditMode.value ? "单条编辑" : "批量创建",
);

const dialogSelectionBadgeLabel = computed(() =>
  isEditMode.value
    ? `事件：${lockedEventTypeLabel.value}`
    : `已选 ${selectedEventTypeCount.value} 个事件`,
);

const dialogTargetsBadgeLabel = computed(() =>
  ruleForm.value.targets.length > 0
    ? `${ruleForm.value.targets.length} 个通知目标`
    : "尚未添加通知目标",
);

const groupByHint = computed(() => {
  if (ruleForm.value.group_by !== "auto") {
    return "";
  }

  if (ruleForm.value.event_types.length === 1) {
    const onlyEventType = ruleForm.value.event_types[0]!;
    return `将使用推荐聚合维度：${formatNotificationGroupByLabel(
      DEFAULT_GROUP_BY_BY_EVENT_TYPE[onlyEventType],
    )}`;
  }

  if (ruleForm.value.event_types.length > 1) {
    return "保存时会按每个事件的推荐聚合维度分别创建规则。";
  }

  return "";
});

const loadData = async () => {
  loading.value = true;
  try {
    const [catalogResult, providersResult, rulesResult] = await Promise.all([
      EventCenterAPI.getNotificationProviderCatalog(),
      EventCenterAPI.getNotificationProviders(),
      EventCenterAPI.getNotificationRules(),
    ]);

    if (!catalogResult.success) {
      throw new Error(catalogResult.message || "加载提供商目录失败");
    }
    if (!providersResult.success) {
      throw new Error(providersResult.message || "加载提供商列表失败");
    }
    if (!rulesResult.success) {
      throw new Error(rulesResult.message || "加载规则列表失败");
    }

    catalog.value = catalogResult.data.providers || [];
    providers.value = providersResult.data.providers || [];
    rules.value = rulesResult.data.rules || [];
  } catch (error) {
    toast.error("加载通知规则失败", {
      description: error instanceof Error ? error.message : "请稍后重试",
    });
  } finally {
    loading.value = false;
  }
};

const resolveProviderById = (providerId: string) =>
  providers.value.find((provider) => provider.id === providerId) || null;

const resolveProviderDefinitionById = (providerId: string) => {
  const provider = resolveProviderById(providerId);
  if (!provider) return null;
  return catalog.value.find((item) => item.type === provider.type) || null;
};

const createTarget = (
  providerId = providers.value[0]?.id || "",
): EditableRuleTarget => {
  const definition = resolveProviderDefinitionById(providerId);
  return {
    provider_id: providerId,
    target_config: definition
      ? createEditableSchemaRecord(definition.target_schema)
      : {},
    delivery_policy: createEmptyDeliveryPolicy(),
    template_override_mode: "inherit",
    template_override: null,
  };
};

const resetRuleForm = () => {
  ruleForm.value = {
    event_types: [...availableEventTypes.value],
    window_seconds: DEFAULT_RULE_WINDOW_SECONDS,
    threshold_count: "1",
    group_by: "auto",
    cooldown_seconds: DEFAULT_RULE_COOLDOWN_SECONDS,
    targets: [],
  };
};

const openCreateDialog = () => {
  dialogMode.value = "create";
  editingRule.value = null;
  resetRuleForm();
  dialogOpen.value = true;
};

const getCreateRuleUnavailableTip = () => {
  if (!hasProviders.value) {
    return {
      title: "暂时无法新增规则",
      description: "请先在“提供商”选项卡中添加至少一个通知提供商",
    };
  }

  if (!hasAvailableEventTypes.value) {
    return {
      title: "当前没有可新增的规则",
      description: "所有事件都已经有规则了，如需重建请先删除原规则",
    };
  }

  return null;
};

const handleCreateRuleClick = () => {
  const unavailableTip = getCreateRuleUnavailableTip();
  if (unavailableTip) {
    toast.info(unavailableTip.title, {
      description: unavailableTip.description,
    });
    return;
  }

  openCreateDialog();
};

const openEditDialog = (rule: NotificationRule) => {
  dialogMode.value = "edit";
  editingRule.value = rule;
  ruleForm.value = {
    event_types: [rule.event_type],
    window_seconds: String(rule.window_seconds),
    threshold_count: String(rule.threshold_count),
    group_by: rule.group_by,
    cooldown_seconds: String(rule.cooldown_seconds),
    targets: rule.targets.map((target) => {
      const definition = resolveProviderDefinitionById(target.provider_id);
      return {
        id: target.id,
        provider_id: target.provider_id,
        target_config: definition
          ? createEditableSchemaRecord(
              definition.target_schema,
              target.target_config,
            )
          : {},
        delivery_policy: {
          timeout_seconds: String(
            target.delivery_policy?.timeout_seconds ?? "",
          ),
          max_attempts: String(target.delivery_policy?.max_attempts ?? ""),
          backoff_seconds: String(
            target.delivery_policy?.backoff_seconds ?? "",
          ),
        },
        template_override_mode: target.template_override_mode || "inherit",
        template_override: target.template_override ?? null,
      };
    }),
  };
  dialogOpen.value = true;
};

const addTarget = (providerId = providers.value[0]?.id || "") => {
  if (!providerId) return;
  if (selectedTargetProviderIds.value.has(providerId)) {
    toast.info("该提供商已经添加到当前规则");
    return;
  }
  ruleForm.value.targets.push(createTarget(providerId));
};

const removeTarget = (index: number) => {
  ruleForm.value.targets.splice(index, 1);
};

const toggleAllEventTypes = (checked: unknown) => {
  if (Boolean(checked)) {
    ruleForm.value.event_types = [...availableEventTypes.value];
    return;
  }
  ruleForm.value.event_types = [];
};

const toggleEventType = (eventType: SystemEventType, checked: unknown) => {
  const nextChecked = Boolean(checked);
  const nextSelection = new Set(ruleForm.value.event_types);

  if (nextChecked) {
    nextSelection.add(eventType);
  } else {
    nextSelection.delete(eventType);
  }

  ruleForm.value.event_types = availableEventTypes.value.filter((type) =>
    nextSelection.has(type),
  );
};

const parseOptionalPolicyNumber = (value: string) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const buildDeliveryPolicyPayload = (
  policy: EditableRuleTarget["delivery_policy"],
): NotificationDeliveryPolicy | undefined => {
  const payload: NotificationDeliveryPolicy = {
    timeout_seconds: parseOptionalPolicyNumber(policy.timeout_seconds),
    max_attempts: parseOptionalPolicyNumber(policy.max_attempts),
    backoff_seconds: parseOptionalPolicyNumber(policy.backoff_seconds),
  };
  if (
    payload.timeout_seconds === undefined &&
    payload.max_attempts === undefined &&
    payload.backoff_seconds === undefined
  ) {
    return undefined;
  }
  return payload;
};

const resolveGroupByForEventType = (
  eventType: SystemEventType,
): NotificationGroupBy =>
  ruleForm.value.group_by === "auto"
    ? DEFAULT_GROUP_BY_BY_EVENT_TYPE[eventType]
    : ruleForm.value.group_by;

const buildRulePayload = (
  eventType: SystemEventType,
  groupBy: NotificationGroupBy,
) => ({
  enabled: true,
  event_type: eventType,
  event_level_filter: [],
  event_source_filter: [],
  window_seconds: Number(ruleForm.value.window_seconds || 0),
  threshold_count: Number(ruleForm.value.threshold_count || 0),
  group_by: groupBy,
  cooldown_seconds: Number(ruleForm.value.cooldown_seconds || 0),
  message_template_mode: "default",
  targets: ruleForm.value.targets.map((target) => {
    const definition = resolveProviderDefinitionById(target.provider_id);
    return {
      ...(target.id ? { id: target.id } : {}),
      provider_id: target.provider_id,
      enabled: true,
      target_config: buildSchemaPayload({
        fields: definition?.target_schema || [],
        value: target.target_config,
      }),
      delivery_policy: buildDeliveryPolicyPayload(target.delivery_policy),
      template_override_mode: target.template_override_mode,
      template_override: target.template_override,
    };
  }),
});

const saveRule = async () => {
  if (!ruleForm.value.targets.length) {
    toast.error("请至少添加一个通知目标");
    return;
  }

  const selectedEventTypes = ruleForm.value.event_types;
  if (!selectedEventTypes.length) {
    toast.error("请至少选择一个事件");
    return;
  }

  if (dialogMode.value === "edit" && selectedEventTypes.length !== 1) {
    toast.error("编辑现有规则时只能保留一个事件类型");
    return;
  }

  saving.value = true;
  try {
    if (dialogMode.value === "create") {
      const batchPlans = selectedEventTypes.map((eventType) => {
        return {
          eventType,
          name: buildRuleDisplayName(eventType),
          groupBy: resolveGroupByForEventType(eventType),
        };
      });

      const results = await Promise.allSettled(
        batchPlans.map(async (plan) => {
          const result = await EventCenterAPI.createNotificationRule(
            buildRulePayload(plan.eventType, plan.groupBy),
          );

          if (!result.success) {
            throw new Error(result.message || `创建规则 ${plan.name} 失败`);
          }

          return plan.name;
        }),
      );

      const succeeded = results
        .filter(
          (item): item is PromiseFulfilledResult<string> =>
            item.status === "fulfilled",
        )
        .map((item) => item.value);
      const failed = results
        .filter(
          (item): item is PromiseRejectedResult => item.status === "rejected",
        )
        .map((item) =>
          item.reason instanceof Error
            ? item.reason.message
            : "创建通知规则失败",
        );

      if (failed.length === results.length) {
        throw new Error(failed[0] || "创建通知规则失败");
      }

      if (failed.length > 0) {
        toast.info(
          `已创建 ${succeeded.length} 条规则，${failed.length} 条失败`,
          {
            description: failed[0],
          },
        );
      } else {
        toast.success(
          succeeded.length > 1
            ? `已创建 ${succeeded.length} 条规则`
            : "规则已创建",
        );
      }

      dialogOpen.value = false;
      await loadData();
      return;
    }

    const eventType = selectedEventTypes[0]!;
    const result = await EventCenterAPI.updateNotificationRule(
      editingRule.value!.id,
      buildRulePayload(eventType, resolveGroupByForEventType(eventType)),
    );

    if (!result.success) {
      throw new Error(result.message || "更新规则失败");
    }

    toast.success("规则已更新");
    dialogOpen.value = false;
    await loadData();
  } catch (error) {
    toast.error(dialogMode.value === "create" ? "创建失败" : "更新失败", {
      description: error instanceof Error ? error.message : "请稍后重试",
    });
  } finally {
    saving.value = false;
  }
};

const deleteRule = async (rule: NotificationRule) => {
  deletingId.value = rule.id;
  try {
    const result = await EventCenterAPI.deleteNotificationRule(rule.id);
    if (!result.success) {
      throw new Error(result.message || "删除规则失败");
    }
    toast.success("规则已删除");
    await loadData();
  } catch (error) {
    toast.error("删除规则失败", {
      description: error instanceof Error ? error.message : "请稍后重试",
    });
  } finally {
    deletingId.value = null;
  }
};

const clearAllRules = async () => {
  if (rules.value.length === 0) {
    clearAllDialogOpen.value = false;
    return;
  }

  clearingAll.value = true;
  try {
    const results = await Promise.allSettled(
      rules.value.map(async (rule) => {
        const result = await EventCenterAPI.deleteNotificationRule(rule.id);
        if (!result.success) {
          throw new Error(result.message || `删除规则 ${rule.name} 失败`);
        }
        return rule.name;
      }),
    );

    const succeeded = results
      .filter(
        (item): item is PromiseFulfilledResult<string> =>
          item.status === "fulfilled",
      )
      .map((item) => item.value);
    const failed = results
      .filter(
        (item): item is PromiseRejectedResult => item.status === "rejected",
      )
      .map((item) =>
        item.reason instanceof Error ? item.reason.message : "删除通知规则失败",
      );

    if (failed.length === results.length) {
      throw new Error(failed[0] || "清空通知规则失败");
    }

    if (failed.length > 0) {
      toast.info(`已删除 ${succeeded.length} 条规则，${failed.length} 条失败`, {
        description: failed[0],
      });
    } else {
      toast.success(`已清空 ${succeeded.length} 条规则`);
    }

    clearAllDialogOpen.value = false;
    await loadData();
  } catch (error) {
    toast.error("清空规则失败", {
      description: error instanceof Error ? error.message : "请稍后重试",
    });
  } finally {
    clearingAll.value = false;
  }
};

const resolveProviderName = (providerId: string) =>
  resolveProviderById(providerId)?.name || providerId;

const resolveProviderTypeLabel = (providerId: string) => {
  const definition = resolveProviderDefinitionById(providerId);
  if (definition) {
    return definition.label;
  }

  return resolveProviderById(providerId)?.type || "未知类型";
};

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
      <div class="space-y-1">
        <div class="text-xs text-muted-foreground">
          右侧动作菜单支持快速清空已有规则。
        </div>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <RefreshButton
          :loading="loading"
          :disabled="loading || clearingAll"
          @click="loadData"
        />
        <div class="flex">
          <Button
            class="rounded-r-none"
            :disabled="loading || clearingAll"
            @click="handleCreateRuleClick"
          >
            <Plus class="mr-2 h-4 w-4" />
            新增规则
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="default"
                size="icon"
                class="rounded-l-none border-l border-primary-foreground/20 px-2"
                :disabled="loading || clearingAll"
              >
                <ChevronDown class="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-52">
              <DropdownMenuItem
                variant="destructive"
                :disabled="rules.length === 0 || clearingAll"
                @click="clearAllDialogOpen = true"
              >
                <Trash2 class="mr-2 h-4 w-4" />
                清空全部规则
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>

    <div
      v-if="!hasProviders"
      class="rounded-md border border-dashed bg-muted/30 px-4 py-6 text-sm text-muted-foreground"
    >
      还没有可用的通知提供商。请先在“提供商”选项卡配置至少一个
      provider。
    </div>

    <div
      v-else-if="!hasAvailableEventTypes"
      class="rounded-md border border-dashed bg-muted/30 px-4 py-6 text-sm text-muted-foreground"
    >
      所有事件都已经配置规则。如需重新配置，请先删除已有规则后再新增。
    </div>

    <div class="overflow-hidden rounded-md border bg-background">
      <div class="overflow-x-auto">
        <Table class="min-w-[700px] sm:min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead
                class="sticky left-0 z-20 w-[168px] min-w-[168px] border-r bg-background sm:w-[220px] sm:min-w-[220px]"
              >
                规则名称
              </TableHead>
              <TableHead>事件类型</TableHead>
              <TableHead>触发条件</TableHead>
              <TableHead>聚合维度</TableHead>
              <TableHead>目标数量</TableHead>
              <TableHead>最近触发</TableHead>
              <TableHead class="w-[140px] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="loading && rules.length === 0">
              <TableCell colspan="7" class="py-10 text-center">
                <Loader2
                  class="mx-auto h-5 w-5 animate-spin text-muted-foreground"
                />
              </TableCell>
            </TableRow>
            <TableRow v-else-if="rules.length === 0">
              <TableCell colspan="7" class="py-10 text-center text-muted-foreground">
                暂无通知规则
              </TableCell>
            </TableRow>
            <TableRow v-for="rule in rules" :key="rule.id">
              <TableCell
                class="sticky left-0 z-10 w-[168px] min-w-[168px] border-r bg-background sm:w-[220px] sm:min-w-[220px]"
              >
                <div class="space-y-1">
                  <div class="font-medium">
                    {{ buildRuleDisplayName(rule.event_type) }}
                  </div>
                  <div class="line-clamp-2 text-xs text-muted-foreground">
                    <span
                      v-for="target in rule.targets"
                      :key="target.id"
                      class="mr-2 inline-block"
                    >
                      {{ resolveProviderName(target.provider_id) }}
                    </span>
                  </div>
                </div>
              </TableCell>
              <TableCell>{{ formatSystemEventTypeLabel(rule.event_type) }}</TableCell>
              <TableCell>
                {{ rule.window_seconds }} 秒内触发
                {{ rule.threshold_count }} 次
              </TableCell>
              <TableCell>{{
                formatNotificationGroupByLabel(rule.group_by)
              }}</TableCell>
              <TableCell>{{ rule.targets.length }}</TableCell>
              <TableCell class="text-sm text-muted-foreground">
                <span v-if="rule.last_triggered_at">
                  <HumanFriendlyTime :value="rule.last_triggered_at" />
                </span>
                <span v-else>-</span>
              </TableCell>
              <TableCell class="text-right">
                <div class="inline-flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    :disabled="clearingAll"
                    @click="openEditDialog(rule)"
                  >
                    <Pencil class="h-4 w-4" />
                  </Button>
                  <ConfirmDangerPopover
                    title="确认删除该规则？"
                    description="删除后不会影响已有事件，但后续不再触发通知。"
                    :loading="deletingId === rule.id"
                    :disabled="deletingId === rule.id || clearingAll"
                    :on-confirm="() => deleteRule(rule)"
                  >
                    <template #trigger>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="text-destructive"
                        :disabled="deletingId === rule.id || clearingAll"
                      >
                        <Trash2 class="h-4 w-4" />
                      </Button>
                    </template>
                  </ConfirmDangerPopover>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  </div>

  <Dialog v-model:open="dialogOpen">
    <DialogContent
      class="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1040px]"
    >
      <DialogHeader
        class="border-b bg-gradient-to-r from-muted/40 via-background to-background px-4 py-5 sm:px-6"
      >
        <div class="space-y-3">
          <div class="space-y-1.5">
            <DialogTitle>{{ dialogTitleText }}</DialogTitle>
            <DialogDescription>{{ dialogDescriptionText }}</DialogDescription>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              class="rounded-full bg-primary/10 px-3 py-1 text-primary"
            >
              {{ dialogModeBadgeLabel }}
            </Badge>
            <Badge variant="outline" class="rounded-full px-3 py-1">
              {{ dialogSelectionBadgeLabel }}
            </Badge>
            <Badge variant="outline" class="rounded-full px-3 py-1">
              {{ dialogTargetsBadgeLabel }}
            </Badge>
          </div>
        </div>
      </DialogHeader>

      <div
        class="flex-1 space-y-6 overflow-y-auto bg-background px-4 py-5 sm:px-6"
      >
        <section
          v-if="!isEditMode"
          class="space-y-4 border-b border-border/60 pb-6"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="space-y-1">
              <div class="text-sm font-semibold">触发事件</div>
              <div class="text-xs text-muted-foreground">
                仅展示尚未配置规则的事件，可一次批量创建多条规则。
              </div>
            </div>
            <div class="flex items-center gap-2">
              <div
                class="flex items-center gap-2 px-3 py-2"
              >
                <Checkbox
                  :model-value="isAllEventTypesSelected"
                  @update:model-value="toggleAllEventTypes"
                />
                <span class="text-xs text-muted-foreground">全选</span>
              </div>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label
              v-for="option in availableEventTypeOptions"
              :key="option.value"
              class="flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-all"
              :class="
                ruleForm.event_types.includes(option.value)
                  ? 'border-primary/40 bg-primary/5 shadow-sm'
                  : 'border-border/70 hover:border-primary/20 hover:bg-muted/30'
              "
            >
              <Checkbox
                :model-value="ruleForm.event_types.includes(option.value)"
                @update:model-value="
                  (value) => toggleEventType(option.value, value)
                "
              />
              <div class="space-y-1">
                <div class="text-sm font-medium leading-5">
                  {{ option.label }}
                </div>
                <div class="text-xs text-muted-foreground">
                  推荐聚合维度：
                  {{
                    formatNotificationGroupByLabel(
                      DEFAULT_GROUP_BY_BY_EVENT_TYPE[option.value],
                    )
                  }}
                </div>
              </div>
            </label>
          </div>
        </section>

        <section
          v-if="isEditMode"
          class="space-y-3 border-b border-border/60 pb-6"
        >
          <div class="space-y-1">
            <div class="text-sm font-semibold">触发条件</div>
            <div class="text-xs text-muted-foreground">
              定义频次、聚合方式和冷却时间。
            </div>
          </div>
          <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div class="space-y-2">
              <Label>时间窗口（秒）</Label>
              <Input
                v-model="ruleForm.window_seconds"
                type="number"
                min="1"
                :placeholder="DEFAULT_RULE_WINDOW_SECONDS"
              />
            </div>

            <div class="space-y-2">
              <Label>触发次数</Label>
              <Input
                v-model="ruleForm.threshold_count"
                type="number"
                min="1"
                placeholder="1"
              />
            </div>

            <div class="space-y-2">
              <Label>聚合维度</Label>
              <Select v-model="ruleForm.group_by">
                <SelectTrigger>
                  <SelectValue placeholder="选择聚合维度" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">按事件自动推荐</SelectItem>
                  <SelectItem
                    v-for="option in NOTIFICATION_GROUP_BY_OPTIONS"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <div v-if="groupByHint" class="text-xs text-muted-foreground">
                {{ groupByHint }}
              </div>
            </div>

            <div class="space-y-2">
              <Label>冷却时间（秒）</Label>
              <Input
                v-model="ruleForm.cooldown_seconds"
                type="number"
                min="0"
                :placeholder="DEFAULT_RULE_COOLDOWN_SECONDS"
              />
            </div>
          </div>
        </section>

        <section class="space-y-4">
          <div
            class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <div class="space-y-1">
              <div class="text-sm font-semibold">通知目标</div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="outline"
                  size="sm"
                  class="self-start"
                  :disabled="!hasProviders || !hasAvailableProvidersForAdd"
                >
                  <Plus class="mr-2 h-4 w-4" />
                  添加目标
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-64">
                <DropdownMenuItem
                  v-for="provider in availableProvidersForAdd"
                  :key="provider.id"
                  @click="addTarget(provider.id)"
                >
                  <div class="flex min-w-0 flex-col">
                    <span class="truncate font-medium">{{
                      provider.name
                    }}</span>
                    <span class="text-xs text-muted-foreground">
                      {{ resolveProviderTypeLabel(provider.id) }}
                    </span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div
            v-if="!ruleForm.targets.length"
            class="text-sm text-muted-foreground"
          >
            还没有目标。至少需要绑定一个通知目标。
          </div>

          <div
            v-else
            class="overflow-hidden rounded-lg border border-border/70 bg-background"
          >
            <div
              class="hidden grid-cols-[minmax(0,1fr)_180px_auto] gap-4 border-b bg-muted/20 px-4 py-3 text-xs font-medium text-muted-foreground sm:grid"
            >
              <div>目标名</div>
              <div>提供商类型</div>
              <div class="text-right">操作</div>
            </div>

            <div
              v-for="(target, index) in ruleForm.targets"
              :key="target.id || index"
              class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 border-b border-border/60 px-4 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:gap-4"
            >
              <div class="min-w-0 pr-2 sm:pr-0">
                <div
                  class="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground sm:hidden"
                >
                  目标名
                </div>
                <div class="break-words text-sm font-medium sm:truncate">
                  {{ resolveProviderName(target.provider_id) }}
                </div>
              </div>

              <div class="col-span-2 min-w-0 sm:col-span-1 sm:pt-0.5">
                <div
                  class="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground sm:hidden"
                >
                  提供商类型
                </div>
                <div class="text-sm text-muted-foreground">
                  {{ resolveProviderTypeLabel(target.provider_id) }}
                </div>
              </div>

              <div
                class="col-start-2 row-start-1 flex items-start justify-end sm:col-start-auto sm:row-start-auto"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  class="text-destructive"
                  :disabled="ruleForm.targets.length <= 1"
                  @click="removeTarget(index)"
                >
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>

              <div
                v-if="
                  resolveProviderDefinitionById(target.provider_id) &&
                  resolveProviderDefinitionById(target.provider_id)!
                    .target_schema.length > 0
                "
                class="col-span-2 rounded-md border border-dashed bg-muted/10 p-3 sm:col-span-3"
              >
                <div class="mb-3 text-xs font-medium text-muted-foreground">
                  目标配置
                </div>
                <SchemaFieldsEditor
                  :fields="
                    resolveProviderDefinitionById(target.provider_id)!
                      .target_schema
                  "
                  :model-value="target.target_config"
                  @update:model-value="
                    (value) => {
                      ruleForm.targets[index]!.target_config = value;
                    }
                  "
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      <div
        class="flex flex-col-reverse gap-2 border-t bg-background px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
      >
        <div class="text-xs text-muted-foreground">
          {{
            isEditMode
              ? "保存后会立即更新当前规则配置。"
              : "保存后会按默认触发条件批量创建规则，后续可逐条编辑。"
          }}
        </div>
        <DialogFooter class="gap-2 sm:flex-row">
          <Button variant="outline" @click="dialogOpen = false">取消</Button>
          <Button :disabled="saving" @click="saveRule">
            <Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />
            保存
          </Button>
        </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="clearAllDialogOpen">
    <DialogContent class="sm:max-w-[420px]">
      <DialogHeader>
        <DialogTitle>清空全部规则</DialogTitle>
        <DialogDescription>
          这会依次删除当前所有通知规则。已产生的事件记录不会受影响，但后续不会再触发通知。
        </DialogDescription>
      </DialogHeader>

      <DialogFooter class="gap-2">
        <Button
          variant="outline"
          :disabled="clearingAll"
          @click="clearAllDialogOpen = false"
        >
          取消
        </Button>
        <Button
          variant="destructive"
          :disabled="clearingAll || rules.length === 0"
          @click="clearAllRules"
        >
          <Loader2 v-if="clearingAll" class="mr-2 h-4 w-4 animate-spin" />
          清空全部规则
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
