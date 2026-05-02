<template>
  <div class="auth-safe-shell flex flex-col bg-muted/40">
    <div class="flex flex-1 items-center justify-center">
      <Card class="w-full max-w-sm">
        <CardHeader>
          <CardTitle class="text-2xl text-center">绑定外部账号</CardTitle>
          <CardDescription class="text-center">
            {{ description }}
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div v-if="isLoading" class="py-8 text-center text-sm text-muted-foreground">
            正在检查邀请链接...
          </div>
          <div
            v-else-if="errorMessage"
            class="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            {{ errorMessage }}
          </div>
          <div v-else class="space-y-4">
            <div class="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              <div class="text-muted-foreground">绑定到</div>
              <div class="font-medium">{{ invite?.totp.comment || "TOTP" }}</div>
            </div>
            <Button
              v-for="provider in invite?.providers || []"
              :key="provider.id"
              type="button"
              variant="outline"
              class="w-full"
              :disabled="isStarting"
              @click="startBind(provider.id)"
            >
              <span
                v-if="activeProviderId === provider.id && isStarting"
                class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
              ></span>
              使用 {{ provider.name }} 绑定
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";

type InviteDetails = {
  totp: { id: string; comment: string };
  provider_id?: string;
  expires_at: string;
  providers: Array<{ id: string; type: string; name: string }>;
};

const params =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
const token = params.get("token") || "";
const invite = ref<InviteDetails | null>(null);
const errorMessage = ref("");
const isLoading = ref(true);
const isStarting = ref(false);
const activeProviderId = ref("");

const description = computed(() => {
  if (errorMessage.value) return "邀请链接不可用";
  if (!invite.value) return "请稍候";
  return "选择一个提供商完成登录并绑定";
});

onMounted(loadInvite);

async function loadInvite() {
  isLoading.value = true;
  errorMessage.value = "";
  try {
    if (!token) throw new Error("邀请链接缺少 token");
    const res = await apiClient.get("/oidc/invite", {
      params: { token },
    });
    invite.value = res.data.data;
    if (!invite.value?.providers.length) {
      throw new Error("当前没有可用的外部登录提供商");
    }
  } catch (error: any) {
    errorMessage.value =
      error?.response?.data?.message || error?.message || "邀请链接已失效";
  } finally {
    isLoading.value = false;
  }
}

async function startBind(providerId: string) {
  if (isStarting.value) return;
  isStarting.value = true;
  activeProviderId.value = providerId;
  errorMessage.value = "";
  try {
    const res = await apiClient.post("/oidc/start", {
      provider_id: providerId,
      mode: "bind",
      invite_token: token,
      rememberMe: false,
    });
    const authorizationUrl = res.data?.data?.authorization_url;
    if (!authorizationUrl) {
      throw new Error(res.data?.message || "无法发起外部账号绑定");
    }
    window.location.assign(authorizationUrl);
  } catch (error: any) {
    errorMessage.value =
      error?.response?.data?.message ||
      error?.message ||
      "外部账号绑定失败，请重试";
    isStarting.value = false;
    activeProviderId.value = "";
  }
}
</script>
