<template>
  <div class="relative min-h-screen overflow-hidden bg-muted/40 p-4">
    <div
      class="absolute inset-0 -z-10 bg-white bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]"
    ></div>

    <div class="flex min-h-[calc(100vh-2rem)] items-center justify-center">
      <Card class="w-full max-w-sm border-border/80 shadow-sm">
        <CardHeader class="space-y-2">
          <CardTitle class="text-center text-2xl tracking-tight">
            {{ title }}
          </CardTitle>
          <CardDescription class="text-center leading-6">
            {{ description }}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form class="space-y-4" autocomplete="off" @submit.prevent="submit">
            <Input
              v-model="password"
              type="password"
              :placeholder="placeholder"
              :autocomplete="autocomplete"
              class="h-11"
              :disabled="loading"
            />

            <p
              v-if="helperText"
              class="text-xs leading-5 text-muted-foreground"
            >
              {{ helperText }}
            </p>

            <div
              v-if="errorMessage"
              class="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm leading-6 text-destructive"
            >
              {{ errorMessage }}
            </div>

            <Button
              type="submit"
              class="h-11 w-full"
              :disabled="loading || !password.trim()"
            >
              <span
                v-if="loading"
                class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-foreground"
              ></span>
              {{ actionLabel }}
            </Button>

            <Button
              v-if="showRetry"
              type="button"
              variant="outline"
              class="h-11 w-full"
              :disabled="loading"
              @click="$emit('retry')"
            >
              重新检测状态
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const props = defineProps<{
  mode: "setup" | "login";
  loading: boolean;
  errorMessage?: string;
  showRetry?: boolean;
}>();

const emit = defineEmits<{
  submit: [password: string];
  retry: [];
}>();

const password = ref("");

const title = computed(() =>
  props.mode === "setup" ? "设置管理面板密码" : "登录管理面板",
);
const description = computed(() =>
  props.mode === "setup"
    ? "首次进入需要先设置一个管理密码。"
    : "请输入管理密码继续访问 Docker 管理后台。",
);
const helperText = computed(() =>
  props.mode === "setup"
    ? "至少 6 位，并同时包含字母和数字。"
    : "",
);
const actionLabel = computed(() =>
  props.mode === "setup" ? "设置并进入" : "登录并进入",
);
const placeholder = computed(() =>
  props.mode === "setup" ? "设置管理面板密码" : "输入管理面板密码",
);
const autocomplete = computed(() =>
  props.mode === "setup" ? "new-password" : "current-password",
);

const submit = () => {
  emit("submit", password.value);
};

watch(
  () => props.mode,
  () => {
    password.value = "";
  },
);

watch(
  () => props.loading,
  (loading) => {
    if (!loading && !props.errorMessage) {
      password.value = "";
    }
  },
);
</script>
