<template>
  <div class="space-y-4">
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#/auth">TOTP 管理</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{{ pageTitle }}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <Card>
      <CardHeader>
        <CardTitle>快捷登录凭据</CardTitle>
        <CardDescription>管理已绑定的 Passkey 设备与外部账号。</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div
          v-if="isLoading"
          class="flex items-center justify-center py-10 text-sm text-muted-foreground"
        >
          <span
            class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
          ></span>
          正在加载快捷登录凭据...
        </div>
        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead>Passkey</TableHead>
              <TableHead>设备</TableHead>
              <TableHead>绑定时间</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="passkey in passkeys" :key="passkey.id">
              <TableCell class="font-mono text-xs text-muted-foreground">
                {{ formatId(passkey.id) }}
              </TableCell>
              <TableCell>{{ passkey.deviceName }}</TableCell>
              <TableCell
                ><HumanFriendlyTime :value="passkey.createdAt"
              /></TableCell>
              <TableCell class="text-right">
                <ConfirmDangerPopover
                  title="删除 Passkey"
                  description="确认删除该 Passkey 吗？删除后将无法使用该设备一键登录。"
                  :loading="isDeleting"
                  :disabled="isDeleting"
                  :on-confirm="() => handleDeletePasskey(passkey.id)"
                >
                  <template #trigger>
                    <Button
                      variant="destructive"
                      size="sm"
                      :disabled="isDeleting"
                    >
                      删除
                    </Button>
                  </template>
                </ConfirmDangerPopover>
              </TableCell>
            </TableRow>
            <TableEmpty v-if="passkeys.length === 0" :colspan="4">
              暂无已绑定的 Passkey
            </TableEmpty>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <Card>
      <CardHeader
        class="gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <CardTitle>外部账号绑定</CardTitle>
          <CardDescription>
            绑定 Google、Microsoft、GitHub 或自定义 OIDC 账号。
          </CardDescription>
        </div>
        <div
          class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
        >
          <RefreshButton
            class="w-full sm:w-auto"
            :loading="isLoading || isOidcBindingsRefreshing"
            :disabled="isLoading || isOidcBindingsRefreshing"
            @click="handleRefreshOidcBindings"
          />
          <Button
            variant="outline"
            class="w-full sm:w-auto"
            :disabled="providers.length === 0 || isInviteCreating"
            @click="openInviteDialog"
          >
            <Link2 class="h-4 w-4" />
            生成绑定邀请
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <div
          v-if="providers.length === 0"
          class="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground"
        >
          尚未配置外部登录提供商，请先到“外部账号登录”中添加提供商。
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>提供商</TableHead>
              <TableHead>账号</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>最近使用</TableHead>
              <TableHead class="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="binding in oidcBindings" :key="binding.id">
              <TableCell>{{
                binding.provider_name || binding.provider_type
              }}</TableCell>
              <TableCell>
                <div class="font-medium">{{ binding.display_name || "-" }}</div>
                <div class="text-xs text-muted-foreground">
                  {{ binding.email || "" }}
                </div>
              </TableCell>
              <TableCell class="font-mono text-xs text-muted-foreground">
                {{ formatId(binding.subject) }}
              </TableCell>
              <TableCell>
                <HumanFriendlyTime
                  v-if="binding.last_used_at"
                  :value="binding.last_used_at"
                />
                <span v-else class="text-muted-foreground">-</span>
              </TableCell>
              <TableCell class="text-right">
                <ConfirmDangerPopover
                  title="删除外部账号绑定"
                  description="确认删除该绑定吗？删除后该外部账号将无法登录。"
                  :loading="isDeleting"
                  :disabled="isDeleting"
                  :on-confirm="() => handleDeleteOidcBinding(binding.id)"
                >
                  <template #trigger>
                    <Button
                      variant="destructive"
                      size="sm"
                      :disabled="isDeleting"
                    >
                      删除
                    </Button>
                  </template>
                </ConfirmDangerPopover>
              </TableCell>
            </TableRow>
            <TableEmpty v-if="oidcBindings.length === 0" :colspan="5">
              暂无已绑定的外部账号
            </TableEmpty>
          </TableBody>
        </Table>
        <div v-if="errorMessage" class="text-sm text-destructive">
          {{ errorMessage }}
        </div>
      </CardContent>
    </Card>

    <Dialog :open="showInviteDialog" @update:open="handleInviteDialogOpenChange">
      <DialogContent class="max-h-[88vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>生成外部账号绑定邀请</DialogTitle>
          <DialogDescription>
            对方打开邀请链接并完成指定第三方登录后，该外部账号会绑定到当前
            TOTP。
          </DialogDescription>
        </DialogHeader>
        <div class="overflow-hidden rounded-lg border divide-y divide-border">
          <div class="space-y-2 p-4 transition-colors hover:bg-muted/10 sm:p-5">
            <Label for="oidc-invite-provider">提供商</Label>
            <Select
              :model-value="inviteProviderId"
              @update:model-value="handleInviteProviderChange"
            >
              <SelectTrigger id="oidc-invite-provider" class="w-full">
                <SelectValue placeholder="选择一个已启用提供商" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="provider in providers"
                  :key="provider.id"
                  :value="provider.id"
                >
                  {{ provider.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-[11px] text-muted-foreground">
              邀请有效期固定为 30 分钟。
            </p>
          </div>
          <div
            v-if="inviteUrl"
            class="space-y-3 p-4 transition-colors hover:bg-muted/10 sm:p-5"
          >
            <Label>邀请链接</Label>
            <div
              class="flex items-start gap-2 rounded-md border bg-muted/30 px-2.5 py-2"
            >
              <p
                class="min-w-0 flex-1 whitespace-normal break-all font-mono text-xs leading-5 text-muted-foreground"
              >
                {{ inviteUrl }}
              </p>
              <Button
                variant="ghost"
                size="icon-sm"
                class="size-7 shrink-0"
                title="复制邀请链接"
                aria-label="复制邀请链接"
                @click="copyInviteUrl"
              >
                <Copy class="h-4 w-4" />
              </Button>
            </div>
            <p class="text-xs text-muted-foreground">
              过期时间：{{ inviteExpiresAt || "-" }}
            </p>
          </div>
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showInviteDialog = false"
            >关闭</Button
          >
          <Button
            v-if="inviteUrl"
            variant="outline"
            @click="copyInviteUrl"
          >
            <Copy class="h-4 w-4" />
            复制链接
          </Button>
          <Button
            :disabled="isInviteCreating || !inviteProviderId"
            @click="createInvite"
          >
            <LoaderCircle
              v-if="isInviteCreating"
              class="h-4 w-4 animate-spin"
            />
            <Link2 v-else class="h-4 w-4" />
            生成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
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
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Copy, Link2, LoaderCircle } from "lucide-vue-next";
import ConfirmDangerPopover from "@admin-shared/components/common/ConfirmDangerPopover.vue";
import HumanFriendlyTime from "@admin-shared/components/common/HumanFriendlyTime.vue";
import RefreshButton from "@/components/RefreshButton.vue";
import {
  extractErrorMessage,
  useAsyncAction,
} from "@admin-shared/composables/useAsyncAction";
import { toast } from "@admin-shared/utils/toast";
import { ConfigAPI } from "../lib/api";
import type {
  OIDCBinding,
  OIDCProviderView,
  PasskeyCredential,
} from "../types";

const route = useRoute();
const totpId = route.params.totpId as string;
const OIDC_BINDINGS_AUTO_REFRESH_INTERVAL_MS = 5000;

const passkeys = ref<PasskeyCredential[]>([]);
const oidcBindings = ref<OIDCBinding[]>([]);
const providers = ref<OIDCProviderView[]>([]);
const errorMessage = ref("");
const totpName = ref("");
const showInviteDialog = ref(false);
const inviteProviderId = ref("");
const inviteUrl = ref("");
const inviteExpiresAt = ref("");
const isOidcBindingsRefreshing = ref(false);
let oidcBindingsAutoRefreshTimer: ReturnType<typeof window.setInterval> | null =
  null;

const pageTitle = computed(() =>
  totpName.value ? `${totpName.value} 快捷登录` : "快捷登录凭据",
);

const { isPending: isLoading, run: runLoad } = useAsyncAction({
  onError: (error) => {
    errorMessage.value = extractErrorMessage(error, "获取快捷登录凭据失败");
  },
});
const { isPending: isDeleting, run: runDelete } = useAsyncAction({
  onError: (error) => {
    const message = extractErrorMessage(error, "删除快捷登录凭据失败");
    errorMessage.value = message;
    toast.error("删除失败", { description: message });
  },
});
const { isPending: isInviteCreating, run: runCreateInvite } = useAsyncAction({
  onError: (error) => {
    toast.error(extractErrorMessage(error, "创建绑定邀请失败"));
  },
});

onMounted(fetchCredentials);
onBeforeUnmount(stopOidcBindingsAutoRefresh);

watch(showInviteDialog, (isOpen) => {
  if (isOpen) {
    startOidcBindingsAutoRefresh();
    return;
  }
  stopOidcBindingsAutoRefresh();
});

async function fetchCredentials() {
  errorMessage.value = "";
  await runLoad(async () => {
    totpName.value = "";
    const [passkeysRes, statusRes, bindingsRes, providersRes] =
      await Promise.all([
        ConfigAPI.getPasskeys(totpId),
        ConfigAPI.getTOTPStatus().catch(() => null),
        ConfigAPI.getOIDCBindings(totpId),
        ConfigAPI.getOIDCProviders(),
      ]);
    passkeys.value = passkeysRes;
    oidcBindings.value = bindingsRes;
    providers.value = providersRes.filter((provider) => provider.enabled);
    if (statusRes?.credentials) {
      const parentTotp = statusRes.credentials.find(
        (item) => item.id === totpId,
      );
      if (parentTotp?.comment) totpName.value = parentTotp.comment;
    }
  });
}

async function refreshOidcBindings(options?: {
  notifyOnAdded?: boolean;
  showSuccessToast?: boolean;
  showErrorToast?: boolean;
}) {
  if (isOidcBindingsRefreshing.value) return;

  const previousIds = new Set(oidcBindings.value.map((binding) => binding.id));
  isOidcBindingsRefreshing.value = true;
  try {
    const nextBindings = await ConfigAPI.getOIDCBindings(totpId);
    const addedBindings = nextBindings.filter(
      (binding) => !previousIds.has(binding.id),
    );
    oidcBindings.value = nextBindings;
    errorMessage.value = "";

    if (options?.notifyOnAdded && addedBindings.length > 0) {
      const firstBinding = addedBindings[0];
      if (!firstBinding) return;
      toast.success(
        addedBindings.length > 1
          ? `已添加 ${addedBindings.length} 个外部账号绑定`
          : "外部账号绑定添加成功",
        {
          description: formatOidcBindingLabel(firstBinding),
        },
      );
      return;
    }

    if (options?.showSuccessToast) {
      toast.success("外部账号绑定已刷新");
    }
  } catch (error) {
    const message = extractErrorMessage(error, "刷新外部账号绑定失败");
    errorMessage.value = message;
    if (options?.showErrorToast) {
      toast.error("刷新失败", { description: message });
    } else {
      console.error("refreshOidcBindings:", error);
    }
  } finally {
    isOidcBindingsRefreshing.value = false;
  }
}

function formatOidcBindingLabel(binding: OIDCBinding) {
  return (
    binding.display_name ||
    binding.email ||
    binding.provider_name ||
    binding.provider_type
  );
}

function handleRefreshOidcBindings() {
  void refreshOidcBindings({
    notifyOnAdded: showInviteDialog.value,
    showSuccessToast: !showInviteDialog.value,
    showErrorToast: true,
  });
}

function startOidcBindingsAutoRefresh() {
  stopOidcBindingsAutoRefresh();
  oidcBindingsAutoRefreshTimer = window.setInterval(() => {
    void refreshOidcBindings({ notifyOnAdded: true });
  }, OIDC_BINDINGS_AUTO_REFRESH_INTERVAL_MS);
}

function stopOidcBindingsAutoRefresh() {
  if (oidcBindingsAutoRefreshTimer === null) return;
  window.clearInterval(oidcBindingsAutoRefreshTimer);
  oidcBindingsAutoRefreshTimer = null;
}

function formatId(id: string) {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}...${id.slice(-6)}`;
}

async function handleDeletePasskey(passkeyId: string) {
  errorMessage.value = "";
  await runDelete(async () => {
    await ConfigAPI.deletePasskey(passkeyId);
    await fetchCredentials();
    toast.success("Passkey 已删除");
  });
}

async function handleDeleteOidcBinding(bindingId: string) {
  errorMessage.value = "";
  await runDelete(async () => {
    await ConfigAPI.deleteOIDCBinding(bindingId);
    await fetchCredentials();
    toast.success("外部账号绑定已删除");
  });
}

function openInviteDialog() {
  inviteProviderId.value = providers.value[0]?.id || "";
  inviteUrl.value = "";
  inviteExpiresAt.value = "";
  showInviteDialog.value = true;
}

function handleInviteDialogOpenChange(open: boolean) {
  showInviteDialog.value = open;
}

function handleInviteProviderChange(value: unknown) {
  inviteProviderId.value = String(value ?? "");
  inviteUrl.value = "";
  inviteExpiresAt.value = "";
}

async function createInvite() {
  if (!inviteProviderId.value) {
    toast.error("请选择一个外部登录提供商");
    return;
  }

  await runCreateInvite(async () => {
    const result = await ConfigAPI.createOIDCInvite({
      totp_id: totpId,
      provider_id: inviteProviderId.value,
    });
    inviteUrl.value = result.invite_url;
    inviteExpiresAt.value = result.expires_at;
    try {
      await copyTextToClipboard(result.invite_url);
      toast.success("绑定邀请已生成并复制", {
        description: result.invite_url,
      });
    } catch (error) {
      console.error("createInvite copy:", error);
      toast.warning("绑定邀请已生成，但复制失败", {
        description: "当前页面可能运行在受限环境中，请手动复制。",
      });
    }
  });
}

async function copyInviteUrl() {
  if (!inviteUrl.value) return;
  try {
    await copyTextToClipboard(inviteUrl.value);
    toast.success("邀请链接已复制", { description: inviteUrl.value });
  } catch (error) {
    console.error("copyInviteUrl:", error);
    toast.error("复制邀请链接失败", {
      description: "当前页面可能运行在受限环境中，请手动复制。",
    });
  }
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
</script>
