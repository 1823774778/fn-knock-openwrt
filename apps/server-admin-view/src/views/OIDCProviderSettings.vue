<template>
  <div class="space-y-4">
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#/auth">TOTP 管理</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>外部账号登录</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <Card>
      <CardHeader
        class="gap-4 sm:flex sm:flex-row sm:items-start sm:justify-between"
      >
        <div class="space-y-1.5">
          <CardTitle>OIDC提供商</CardTitle>
          <CardDescription>
            第三方控制台中的回调地址需要与下方 Callback URL 保持一致。
          </CardDescription>
        </div>
        <Button
          class="w-full sm:w-auto"
          :disabled="isLoading"
          @click="openCreateDialog"
        >
          <Plus class="h-4 w-4" />
          添加提供商
        </Button>
      </CardHeader>
      <CardContent class="space-y-4">
        <div
          v-if="isLoading"
          class="py-10 text-center text-sm text-muted-foreground"
        >
          正在加载提供商...
        </div>
        <Table v-else class="table-fixed" container-class="overflow-hidden">
          <colgroup>
            <col class="w-[24%] sm:w-[18%]" />
            <col class="hidden sm:table-column sm:w-[12%]" />
            <col class="hidden md:table-column md:w-[10%]" />
            <col />
            <col class="w-[86px] sm:w-[184px] 2xl:w-[350px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead class="whitespace-normal">名称</TableHead>
              <TableHead class="hidden whitespace-normal sm:table-cell"
                >类型</TableHead
              >
              <TableHead class="hidden whitespace-normal md:table-cell"
                >状态</TableHead
              >
              <TableHead class="min-w-0 whitespace-nowrap">
                Callback URL
              </TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="provider in providers" :key="provider.id">
              <TableCell class="whitespace-normal font-medium">
                {{ provider.name }}
              </TableCell>
              <TableCell class="hidden whitespace-normal sm:table-cell">
                {{ providerLabel(provider.type) }}
              </TableCell>
              <TableCell class="hidden whitespace-normal md:table-cell">
                <Badge variant="outline">{{ providerStatus(provider) }}</Badge>
              </TableCell>
              <TableCell class="min-w-0 max-w-[48vw] sm:max-w-none">
                <div
                  v-if="provider.callback_url"
                  class="group/callback flex min-w-0 max-w-full items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-2"
                >
                  <span
                    class="block min-w-0 flex-1 truncate font-mono text-xs leading-5 text-muted-foreground"
                  >
                    {{ provider.callback_url }}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="size-7 shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/callback:opacity-100 sm:focus-visible:opacity-100"
                    :title="`复制 ${provider.name} Callback URL`"
                    :aria-label="`复制 ${provider.name} Callback URL`"
                    @click="copyCallbackUrl(provider.callback_url)"
                  >
                    <Copy class="h-4 w-4" />
                  </Button>
                </div>
                <span v-else class="text-muted-foreground">-</span>
              </TableCell>
              <TableCell class="text-right">
                <div
                  class="inline-flex flex-nowrap items-center justify-end gap-1.5 2xl:gap-2"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    class="gap-1.5 px-2 2xl:px-2.5"
                    :disabled="isMutating"
                    title="编辑提供商"
                    aria-label="编辑提供商"
                    @click="openEditDialog(provider)"
                  >
                    <Pencil class="h-4 w-4" />
                    <span class="hidden 2xl:inline">编辑</span>
                  </Button>
                  <ConfirmDangerPopover
                    title="删除提供商"
                    description="删除后该提供商下的外部账号绑定也会被移除。"
                    :loading="isMutating"
                    :disabled="isMutating"
                    :on-confirm="() => deleteProvider(provider.id)"
                  >
                    <template #trigger>
                      <Button
                        variant="destructive"
                        size="sm"
                        class="gap-1.5 px-2 2xl:px-2.5"
                        :disabled="isMutating"
                        title="删除提供商"
                        aria-label="删除提供商"
                      >
                        <Trash2 class="h-4 w-4" />
                        <span class="hidden 2xl:inline">删除</span>
                      </Button>
                    </template>
                  </ConfirmDangerPopover>
                </div>
              </TableCell>
            </TableRow>
            <TableEmpty v-if="providers.length === 0" :colspan="5">
              暂无外部登录提供商
            </TableEmpty>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <Dialog :open="showCreateDialog" @update:open="showCreateDialog = $event">
      <DialogContent class="max-h-[88vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>添加外部登录提供商</DialogTitle>
          <DialogDescription>
            配置 Google、Microsoft、GitHub 或自定义 OIDC 提供商。
          </DialogDescription>
        </DialogHeader>
        <div class="overflow-hidden rounded-lg border divide-y divide-border">
          <div class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5">
            <Label for="oidc-provider-type">提供商</Label>
            <Select
              :model-value="form.type"
              @update:model-value="handleCreateProviderTypeChange"
            >
              <SelectTrigger id="oidc-provider-type" class="w-full">
                <SelectValue placeholder="选择提供商" />
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
          <div class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5">
            <Label for="oidc-provider-name">显示名称</Label>
            <Input
              id="oidc-provider-name"
              v-model="form.name"
              placeholder="例如：公司 Google"
            />
          </div>
          <div
            v-if="form.type === 'microsoft'"
            class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5"
          >
            <Label for="oidc-provider-tenant">Tenant</Label>
            <Input
              id="oidc-provider-tenant"
              v-model="form.tenant"
              placeholder="common / organizations / tenant id"
            />
          </div>
          <div class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5">
            <Label for="oidc-provider-client-id">Client ID</Label>
            <Input
              id="oidc-provider-client-id"
              v-model="form.clientId"
              autocomplete="off"
            />
          </div>
          <div class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5">
            <Label for="oidc-provider-client-secret">Client Secret</Label>
            <Input
              id="oidc-provider-client-secret"
              v-model="form.clientSecret"
              type="password"
              autocomplete="new-password"
            />
          </div>
          <div
            v-if="form.type === 'custom_oidc'"
            class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5"
          >
            <Label for="oidc-provider-issuer">Issuer</Label>
            <Input
              id="oidc-provider-issuer"
              v-model="form.issuer"
              placeholder="https://idp.example.com"
            />
          </div>
          <div class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5">
            <Label for="oidc-provider-scopes">Scopes</Label>
            <Input
              id="oidc-provider-scopes"
              v-model="form.scopes"
              placeholder="openid profile email"
            />
          </div>
        </div>
        <DialogFooter class="gap-2">
          <Button
            variant="outline"
            :disabled="isSaving"
            @click="showCreateDialog = false"
          >
            取消
          </Button>
          <Button :disabled="isSaving" @click="handleCreateProvider">
            <LoaderCircle v-if="isSaving" class="h-4 w-4 animate-spin" />
            <Plus v-else class="h-4 w-4" />
            {{ isSaving ? "添加中..." : "添加提供商" }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="showEditDialog" @update:open="showEditDialog = $event">
      <DialogContent class="max-h-[88vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>编辑外部登录提供商</DialogTitle>
          <DialogDescription>
            保存后使用当前 Callback URL 与第三方控制台配置匹配。
          </DialogDescription>
        </DialogHeader>
        <div class="overflow-hidden rounded-lg border divide-y divide-border">
          <div class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5">
            <Label for="oidc-edit-provider-type">类型</Label>
            <Input
              id="oidc-edit-provider-type"
              :model-value="providerLabel(editForm.type)"
              disabled
            />
          </div>
          <div class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5">
            <Label for="oidc-edit-provider-name">显示名称</Label>
            <Input id="oidc-edit-provider-name" v-model="editForm.name" />
          </div>
          <div
            v-if="editForm.type === 'microsoft'"
            class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5"
          >
            <Label for="oidc-edit-provider-tenant">Tenant</Label>
            <Input
              id="oidc-edit-provider-tenant"
              v-model="editForm.tenant"
              placeholder="common / organizations / tenant id"
            />
          </div>
          <div class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5">
            <Label for="oidc-edit-provider-client-id">Client ID</Label>
            <Input
              id="oidc-edit-provider-client-id"
              v-model="editForm.clientId"
              autocomplete="off"
            />
          </div>
          <div class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5">
            <Label for="oidc-edit-provider-client-secret">
              Client Secret
            </Label>
            <Input
              id="oidc-edit-provider-client-secret"
              v-model="editForm.clientSecret"
              type="password"
              autocomplete="new-password"
              placeholder="留空则保持不变"
            />
          </div>
          <div
            v-if="editForm.type === 'custom_oidc'"
            class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5"
          >
            <Label for="oidc-edit-provider-issuer">Issuer</Label>
            <Input
              id="oidc-edit-provider-issuer"
              v-model="editForm.issuer"
              placeholder="https://idp.example.com"
            />
          </div>
          <div class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5">
            <Label for="oidc-edit-provider-scopes">Scopes</Label>
            <Input
              id="oidc-edit-provider-scopes"
              v-model="editForm.scopes"
              placeholder="openid profile email"
            />
          </div>
          <div
            class="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/10 sm:p-5"
          >
            <Label class="text-sm font-medium">启用状态</Label>
            <div class="flex items-center gap-3">
              <Switch v-model="editForm.enabled" />
              <span class="text-sm text-muted-foreground">
                {{ editForm.enabled ? "已启用" : "已停用" }}
              </span>
            </div>
          </div>
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showEditDialog = false">
            取消
          </Button>
          <Button :disabled="isMutating" @click="saveProviderEdit">
            <LoaderCircle v-if="isMutating" class="h-4 w-4 animate-spin" />
            保存提供商
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Copy,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
} from "lucide-vue-next";
import ConfirmDangerPopover from "@admin-shared/components/common/ConfirmDangerPopover.vue";
import {
  extractErrorMessage,
  useAsyncAction,
} from "@admin-shared/composables/useAsyncAction";
import { toast } from "@admin-shared/utils/toast";
import { ConfigAPI } from "../lib/api";
import type {
  ExternalAuthProviderType,
  OIDCProviderCatalogItem,
  OIDCProviderView,
} from "../types";

const catalog = ref<OIDCProviderCatalogItem[]>([]);
const providers = ref<OIDCProviderView[]>([]);
const form = reactive({
  type: "google" as ExternalAuthProviderType,
  name: "",
  clientId: "",
  clientSecret: "",
  issuer: "",
  tenant: "common",
  scopes: "",
});
const showCreateDialog = ref(false);
const showEditDialog = ref(false);
const editForm = reactive({
  id: "",
  type: "google" as ExternalAuthProviderType,
  name: "",
  enabled: false,
  clientId: "",
  clientSecret: "",
  issuer: "",
  tenant: "common",
  scopes: "",
});

const selectedDefinition = computed(() =>
  catalog.value.find((item) => item.type === form.type),
);

const { isPending: isLoading, run: runLoad } = useAsyncAction({
  onError: (error) => {
    toast.error(extractErrorMessage(error, "加载外部登录配置失败"));
  },
});
const { isPending: isSaving, run: runSave } = useAsyncAction({
  onError: (error) => {
    toast.error(extractErrorMessage(error, "保存外部登录提供商失败"));
  },
});
const { isPending: isMutating, run: runMutate } = useAsyncAction({
  onError: (error) => {
    toast.error(extractErrorMessage(error, "操作外部登录提供商失败"));
  },
});

watch(
  selectedDefinition,
  (definition) => {
    if (!definition) return;
    if (!form.name.trim()) form.name = definition.default_name;
    form.scopes = definition.default_scopes.join(" ");
    if (definition.type === "microsoft" && !form.tenant.trim()) {
      form.tenant = "common";
    }
  },
  { immediate: true },
);

onMounted(loadAll);

function resetCreateForm() {
  const definition =
    catalog.value.find((item) => item.type === form.type) || catalog.value[0];
  form.type = (definition?.type || "google") as ExternalAuthProviderType;
  form.name = definition?.default_name || "";
  form.clientId = "";
  form.clientSecret = "";
  form.issuer = "";
  form.tenant = "common";
  form.scopes = definition?.default_scopes.join(" ") || "";
}

function openCreateDialog() {
  resetCreateForm();
  showCreateDialog.value = true;
}

function handleCreateProviderTypeChange(value: unknown) {
  form.type = String(value ?? "") as ExternalAuthProviderType;
  const definition = catalog.value.find((item) => item.type === form.type);
  form.name = definition?.default_name || "";
  form.scopes = definition?.default_scopes.join(" ") || "";
  form.issuer = "";
  form.tenant = "common";
}

function providerLabel(type: string) {
  return catalog.value.find((item) => item.type === type)?.label || type;
}

function normalizeScopes(value: string) {
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function connectionValueText(value: unknown) {
  if (Array.isArray(value)) return value.join(" ");
  return typeof value === "string" ? value : "";
}

function hasConnectionValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" ? value.trim().length > 0 : !!value;
}

function isCreateConfigComplete() {
  const definition = selectedDefinition.value;
  if (!definition) return false;
  const values: Record<string, unknown> = {
    client_id: form.clientId.trim(),
    client_secret: form.clientSecret.trim(),
    issuer:
      form.type === "custom_oidc"
        ? form.issuer.trim()
        : form.type === "microsoft" && form.tenant.trim()
          ? `https://login.microsoftonline.com/${form.tenant.trim()}/v2.0`
          : undefined,
  };
  return definition.required_fields.every((field) =>
    hasConnectionValue(values[field]),
  );
}

function providerHasRequiredConfig(provider: OIDCProviderView) {
  const definition = catalog.value.find((item) => item.type === provider.type);
  if (!definition) return false;
  return definition.required_fields.every((field) =>
    hasConnectionValue(provider.connection_config_masked[field]),
  );
}

function providerStatus(provider: OIDCProviderView) {
  if (!providerHasRequiredConfig(provider)) return "待配置";
  return provider.enabled ? "已启用" : "已停用";
}

async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back below for non-secure or embedded browser contexts.
    }
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard API unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("execCommand copy failed");
  }
}

async function copyCallbackUrl(url: string) {
  try {
    await copyTextToClipboard(url);
    toast.success("Callback URL 已复制", { description: url });
  } catch (error) {
    console.error("copyCallbackUrl:", error);
    toast.error("复制 Callback URL 失败", {
      description: "当前页面可能运行在受限环境中，请手动复制。",
    });
  }
}

async function loadAll() {
  await runLoad(async () => {
    const [catalogData, providersData] = await Promise.all([
      ConfigAPI.getOIDCProviderCatalog(),
      ConfigAPI.getOIDCProviders(),
    ]);
    catalog.value = catalogData;
    providers.value = providersData;
    if (!catalog.value.some((item) => item.type === form.type)) {
      resetCreateForm();
    }
  });
}

async function handleCreateProvider() {
  await runSave(async () => {
    const scopes = normalizeScopes(form.scopes);
    const enabled = isCreateConfigComplete();
    await ConfigAPI.createOIDCProvider({
      type: form.type,
      name: form.name.trim(),
      enabled,
      connection_config: {
        client_id: form.clientId.trim(),
        client_secret: form.clientSecret.trim(),
        ...(form.type === "custom_oidc" ? { issuer: form.issuer.trim() } : {}),
        ...(form.type === "microsoft" ? { tenant: form.tenant.trim() } : {}),
        ...(scopes.length ? { scopes } : {}),
      },
    });
    form.clientId = "";
    form.clientSecret = "";
    showCreateDialog.value = false;
    toast.success(
      enabled ? "外部登录提供商已添加" : "外部登录提供商草稿已添加",
    );
    await loadAll();
  });
}

function openEditDialog(provider: OIDCProviderView) {
  const config = provider.connection_config_masked || {};
  editForm.id = provider.id;
  editForm.type = provider.type;
  editForm.name = provider.name;
  editForm.enabled = provider.enabled;
  editForm.clientId = connectionValueText(config.client_id);
  editForm.clientSecret = "";
  editForm.issuer = connectionValueText(config.issuer);
  editForm.tenant = connectionValueText(config.tenant) || "common";
  editForm.scopes = connectionValueText(config.scopes);
  showEditDialog.value = true;
}

async function saveProviderEdit() {
  if (!editForm.id) return;
  await runMutate(async () => {
    const scopes = normalizeScopes(editForm.scopes);
    const connectionConfig: Record<string, unknown> = {
      client_id: editForm.clientId.trim(),
      ...(editForm.clientSecret.trim()
        ? { client_secret: editForm.clientSecret.trim() }
        : {}),
      ...(editForm.type === "custom_oidc"
        ? { issuer: editForm.issuer.trim() }
        : {}),
      ...(editForm.type === "microsoft"
        ? { tenant: editForm.tenant.trim() }
        : {}),
      ...(scopes.length ? { scopes } : {}),
    };
    await ConfigAPI.updateOIDCProvider(editForm.id, {
      name: editForm.name.trim(),
      enabled: editForm.enabled,
      connection_config: connectionConfig,
    });
    toast.success("外部登录提供商已保存");
    showEditDialog.value = false;
    await loadAll();
  });
}

async function deleteProvider(id: string) {
  await runMutate(async () => {
    await ConfigAPI.deleteOIDCProvider(id);
    toast.success("外部登录提供商已删除");
    await loadAll();
  });
}
</script>
