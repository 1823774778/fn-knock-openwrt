<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  AlertTriangle,
  Loader2,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-vue-next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  NotificationProviderDefinition,
  NotificationProviderView,
} from "../../../types";
import SchemaFieldsEditor from "./SchemaFieldsEditor.vue";
import {
  buildNextSequentialName,
  buildSchemaPayload,
  createEditableSchemaRecord,
} from "./form-utils";

type ProviderDialogMode = "create" | "edit";

type EditableProviderForm = {
  name: string;
  type: string;
  enabled: boolean;
  connection_config: Record<string, unknown>;
};

type ProviderFormPayload = {
  name?: string;
  type: string;
  enabled: boolean;
  connection_config: Record<string, unknown>;
};

const PROVIDER_TAIL_ORDER = [
  "webhook",
  "wxpusher",
  "serverchan",
  "pushplus",
] as const;

const resolveProviderSortWeight = (type: string) => {
  const tailIndex = PROVIDER_TAIL_ORDER.indexOf(
    type as (typeof PROVIDER_TAIL_ORDER)[number],
  );
  return tailIndex === -1 ? 0 : 100 + tailIndex;
};

const sortProviderCatalog = (definitions: NotificationProviderDefinition[]) =>
  [...definitions].sort((left, right) => {
    const weightDiff =
      resolveProviderSortWeight(left.type) -
      resolveProviderSortWeight(right.type);
    if (weightDiff !== 0) return weightDiff;
    return 0;
  });

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
const loading = ref(false);
const dialogOpen = ref(false);
const dialogMode = ref<ProviderDialogMode>("create");
const saving = ref(false);
const testingDraft = ref(false);
const deletingId = ref<string | null>(null);
const testingId = ref<string | null>(null);
const editingId = ref<string | null>(null);
const editingProvider = ref<NotificationProviderView | null>(null);

const providerForm = ref<EditableProviderForm>({
  name: "",
  type: "",
  enabled: true,
  connection_config: {},
});

const selectedDefinition = computed(
  () =>
    catalog.value.find((item) => item.type === providerForm.value.type) ||
    catalog.value[0] ||
    null,
);

const configuredSensitiveFields = computed(() => {
  if (!editingProvider.value || !selectedDefinition.value) return [];
  return selectedDefinition.value.connection_schema
    .filter(
      (field) =>
        field.sensitive &&
        Boolean(editingProvider.value?.connection_config_masked[field.key]),
    )
    .map((field) => field.key);
});

const buildGeneratedProviderName = (type: string) => {
  const baseLabel =
    catalog.value.find((item) => item.type === type)?.label ||
    resolveProviderTypeLabel(type) ||
    "通知提供商";

  return buildNextSequentialName(
    baseLabel,
    providers.value.map((provider) => provider.name),
  );
};

const generatedProviderName = computed(() =>
  buildGeneratedProviderName(providerForm.value.type),
);

const loadData = async () => {
  loading.value = true;
  try {
    const [catalogResult, providersResult] = await Promise.all([
      EventCenterAPI.getNotificationProviderCatalog(),
      EventCenterAPI.getNotificationProviders(),
    ]);

    if (!catalogResult.success) {
      throw new Error(catalogResult.message || "加载提供商目录失败");
    }
    if (!providersResult.success) {
      throw new Error(providersResult.message || "加载提供商列表失败");
    }

    catalog.value = sortProviderCatalog(catalogResult.data.providers || []);
    providers.value = providersResult.data.providers || [];

    if (!providerForm.value.type && catalog.value[0]) {
      providerForm.value.type = catalog.value[0].type;
    }
  } catch (error) {
    toast.error("加载通知提供商失败", {
      description: error instanceof Error ? error.message : "请稍后重试",
    });
  } finally {
    loading.value = false;
  }
};

const resetProviderForm = (definition = catalog.value[0] || null) => {
  const type = definition?.type || "webhook";
  providerForm.value = {
    name: buildGeneratedProviderName(type),
    type,
    enabled: true,
    connection_config: definition
      ? createEditableSchemaRecord(definition.connection_schema)
      : {},
  };
};

const openCreateDialog = () => {
  dialogMode.value = "create";
  editingProvider.value = null;
  resetProviderForm();
  dialogOpen.value = true;
};

const openEditDialog = async (provider: NotificationProviderView) => {
  editingId.value = provider.id;
  try {
    const result = await EventCenterAPI.getNotificationProvider(provider.id);
    if (!result.success) {
      throw new Error(result.message || "加载提供商详情失败");
    }

    const providerDetail = result.data;
    const definition =
      catalog.value.find((item) => item.type === providerDetail.type) || null;
    const connectionConfig = definition
      ? createEditableSchemaRecord(
          definition.connection_schema,
          providerDetail.connection_config,
        )
      : {};

    dialogMode.value = "edit";
    editingProvider.value = providerDetail;
    providerForm.value = {
      name: providerDetail.name,
      type: providerDetail.type,
      enabled: providerDetail.enabled,
      connection_config: connectionConfig,
    };
    dialogOpen.value = true;
  } catch (error) {
    toast.error("加载提供商详情失败", {
      description: error instanceof Error ? error.message : "请稍后重试",
    });
  } finally {
    editingId.value = null;
  }
};

const handleTypeChange = (value: unknown) => {
  if (!value) return;
  const currentType = providerForm.value.type;
  const previousGeneratedName = buildGeneratedProviderName(currentType);
  const nextType = String(value);
  const nextDefinition =
    catalog.value.find((item) => item.type === nextType) || null;
  const shouldRefreshName =
    dialogMode.value === "create" &&
    (!providerForm.value.name.trim() ||
      providerForm.value.name === previousGeneratedName);
  providerForm.value = {
    ...providerForm.value,
    name: shouldRefreshName
      ? buildGeneratedProviderName(nextType)
      : providerForm.value.name,
    type: nextType,
    connection_config: nextDefinition
      ? createEditableSchemaRecord(nextDefinition.connection_schema)
      : {},
  };
};

const buildProviderPayload = (): ProviderFormPayload => {
  const definition = selectedDefinition.value!;
  const trimmedName = providerForm.value.name.trim();
  const connectionConfig = buildSchemaPayload({
    fields: definition.connection_schema,
    value: providerForm.value.connection_config,
    editing: dialogMode.value === "edit",
    configuredSensitiveFields: configuredSensitiveFields.value,
  });

  if (dialogMode.value === "edit" && definition.type === "wxpusher") {
    for (const key of ["uids", "topic_ids", "url"]) {
      if (key in connectionConfig) continue;
      connectionConfig[key] = String(
        providerForm.value.connection_config[key] ?? "",
      ).trim();
    }
  }

  return {
    name: trimmedName || undefined,
    type: providerForm.value.type,
    enabled: providerForm.value.enabled,
    connection_config: connectionConfig,
  };
};

const saveProvider = async () => {
  if (!selectedDefinition.value) {
    toast.error("当前没有可用的提供商类型");
    return;
  }

  saving.value = true;
  try {
    const payload = buildProviderPayload();

    const result =
      dialogMode.value === "create"
        ? await EventCenterAPI.createNotificationProvider(payload)
        : await EventCenterAPI.updateNotificationProvider(
            editingProvider.value!.id,
            payload,
          );

    if (!result.success) {
      throw new Error(
        result.message ||
          (dialogMode.value === "create" ? "创建提供商失败" : "更新提供商失败"),
      );
    }

    const savedName = String(
      result?.data?.name || payload.name || generatedProviderName.value,
    );

    toast.success(
      dialogMode.value === "create"
        ? `提供商 ${savedName} 已创建`
        : `提供商 ${savedName} 已更新`,
    );
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

const testProviderDraft = async () => {
  if (!selectedDefinition.value) {
    toast.error("当前没有可用的提供商类型");
    return;
  }

  testingDraft.value = true;
  try {
    const result = await EventCenterAPI.testNotificationProviderDraft({
      ...buildProviderPayload(),
      id: dialogMode.value === "edit" ? editingProvider.value?.id : undefined,
    });
    if (!result.success) {
      throw new Error(result.message || "测试发送失败");
    }
    toast.success("测试发送成功");
  } catch (error) {
    toast.error("测试发送失败", {
      description:
        error instanceof Error ? error.message : "请检查当前表单配置",
    });
  } finally {
    testingDraft.value = false;
  }
};

const deleteProvider = async (provider: NotificationProviderView) => {
  deletingId.value = provider.id;
  try {
    const result = await EventCenterAPI.deleteNotificationProvider(provider.id);
    if (!result.success) {
      throw new Error(result.message || "删除提供商失败");
    }
    toast.success("提供商已删除");
    await loadData();
  } catch (error) {
    toast.error("删除提供商失败", {
      description: error instanceof Error ? error.message : "请稍后重试",
    });
  } finally {
    deletingId.value = null;
  }
};

const testProvider = async (provider: NotificationProviderView) => {
  testingId.value = provider.id;
  try {
    const result = await EventCenterAPI.testNotificationProvider(provider.id);
    if (!result.success) {
      throw new Error(result.message || "测试发送失败");
    }
    toast.success("测试发送成功");
    await loadData();
  } catch (error) {
    toast.error("测试发送失败", {
      description: error instanceof Error ? error.message : "请检查提供商配置",
    });
  } finally {
    testingId.value = null;
  }
};

const resolveProviderTypeLabel = (type: string) =>
  catalog.value.find((item) => item.type === type)?.label || type;

const showWxPusherAlert = computed(
  () => selectedDefinition.value?.type === "wxpusher",
);

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
        必须先配置提供商，才能在规则里选择发送目标并启用告警通知。
      </div>
      <div class="ml-auto flex items-center gap-2">
        <RefreshButton
          :loading="loading"
          :disabled="loading"
          @click="loadData"
        />
        <Button @click="openCreateDialog">
          <Plus class="mr-2 h-4 w-4" />
          新增提供商
        </Button>
      </div>
    </div>

    <div class="overflow-hidden rounded-md border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>更新时间</TableHead>
            <TableHead class="w-[180px] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-if="loading && providers.length === 0">
            <TableCell colspan="6" class="py-10 text-center">
              <Loader2
                class="mx-auto h-5 w-5 animate-spin text-muted-foreground"
              />
            </TableCell>
          </TableRow>
          <TableRow v-else-if="providers.length === 0">
            <TableCell
              colspan="6"
              class="py-10 text-center text-muted-foreground"
            >
              暂无通知提供商
            </TableCell>
          </TableRow>
          <TableRow v-for="provider in providers" :key="provider.id">
            <TableCell>
              <div class="space-y-1">
                <div class="font-medium">{{ provider.name }}</div>
                <div
                  v-if="provider.last_error"
                  class="line-clamp-2 text-xs text-muted-foreground"
                >
                  最近错误：{{ provider.last_error }}
                </div>
              </div>
            </TableCell>
            <TableCell>{{ resolveProviderTypeLabel(provider.type) }}</TableCell>
            <TableCell>
              <Badge
                variant="outline"
                :class="
                  provider.enabled
                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700'
                    : 'border-muted-foreground/20 bg-muted text-muted-foreground'
                "
              >
                {{ provider.enabled ? "启用" : "停用" }}
              </Badge>
            </TableCell>
            <TableCell class="text-sm text-muted-foreground">
              <HumanFriendlyTime :value="provider.updated_at" />
            </TableCell>
            <TableCell class="text-right">
              <div class="inline-flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  :disabled="testingId === provider.id"
                  @click="testProvider(provider)"
                >
                  <Send class="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  :disabled="editingId === provider.id"
                  @click="openEditDialog(provider)"
                >
                  <Loader2
                    v-if="editingId === provider.id"
                    class="h-4 w-4 animate-spin"
                  />
                  <Pencil v-else class="h-4 w-4" />
                </Button>
                <ConfirmDangerPopover
                  title="确认删除该提供商？"
                  description="若该提供商已被规则引用，后端会阻止删除。"
                  :loading="deletingId === provider.id"
                  :disabled="deletingId === provider.id"
                  :on-confirm="() => deleteProvider(provider)"
                >
                  <template #trigger>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="text-destructive"
                      :disabled="deletingId === provider.id"
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

  <Dialog v-model:open="dialogOpen">
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-[760px]">
      <DialogHeader>
        <DialogTitle>
          {{ dialogMode === "create" ? "新增通知提供商" : "编辑通知提供商" }}
        </DialogTitle>
        <DialogDescription>
          先保存连接能力，再在规则 target 里补充每条规则自己的发送目标。
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-5 py-2">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="space-y-2">
            <Label>名称</Label>
            <Input
              v-model="providerForm.name"
              :placeholder="generatedProviderName"
              :disabled="saving"
            />
            <div class="text-xs text-muted-foreground">
              {{
                dialogMode === "create"
                  ? `默认会生成“${generatedProviderName}”，也可以改成更易识别的名称。`
                  : "可以直接修改当前名称；如果清空则会保留原名称。"
              }}
            </div>
          </div>

          <div class="space-y-2">
            <Label>提供商类型</Label>
            <Select
              :model-value="providerForm.type"
              :disabled="dialogMode === 'edit'"
              @update:model-value="handleTypeChange"
            >
              <SelectTrigger>
                <SelectValue placeholder="选择提供商类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="item in catalog"
                  :key="item.type"
                  :value="item.type"
                >
                  {{ item.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Alert
          v-if="showWxPusherAlert"
          class="border-amber-200 bg-amber-50/80 text-amber-950"
        >
          <AlertTriangle class="h-4 w-4" />
          <AlertTitle>WxPusher 已不再支持微信内消息接收</AlertTitle>
          <AlertDescription class="space-y-2">
            <p>
              该渠道已经不再支持直接通过微信接收推送消息，必须下载并登录
              WxPusher 官方 App 才能正常收到通知。
            </p>
            <p>
              下方新增的 UID / Topic / 跳转链接 /
              订阅验证属于提供商默认值；规则里的同名字段留空时会沿用它们，测试发送也会直接使用这套默认配置。
            </p>
          </AlertDescription>
        </Alert>

        <div class="flex items-center justify-between rounded-md border p-3">
          <div class="space-y-1">
            <div class="text-sm font-medium">启用状态</div>
          </div>
          <Switch v-model="providerForm.enabled" />
        </div>

        <div v-if="selectedDefinition" class="space-y-3">
          <div class="space-y-1">
            <div class="text-sm font-medium">连接配置</div>
          </div>

          <SchemaFieldsEditor
            :fields="selectedDefinition.connection_schema"
            :model-value="providerForm.connection_config"
            :configured-sensitive-fields="configuredSensitiveFields"
            :reveal-sensitive-values="dialogMode === 'edit'"
            @update:model-value="
              (value) => {
                providerForm.connection_config = value;
              }
            "
          />
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          :disabled="saving || testingDraft"
          @click="dialogOpen = false"
        >
          取消
        </Button>
        <Button
          variant="secondary"
          :disabled="saving || testingDraft"
          @click="testProviderDraft"
        >
          <Loader2 v-if="testingDraft" class="mr-2 h-4 w-4 animate-spin" />
          <Send v-else class="mr-2 h-4 w-4" />
          测试提供商
        </Button>
        <Button :disabled="saving || testingDraft" @click="saveProvider">
          <Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />
          保存
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
