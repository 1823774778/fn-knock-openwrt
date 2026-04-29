<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  CheckCircle2,
  ExternalLink,
  Link2,
  LoaderCircle,
  RotateCcw,
  Save,
} from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@admin-shared/utils/toast";
import {
  extractErrorMessage,
  useAsyncAction,
} from "@admin-shared/composables/useAsyncAction";
import { useDelayedLoading } from "@admin-shared/composables/useDelayedLoading";
import { IpLocationSettingsAPI } from "../../lib/api";
import type { IpLocationApiConfig } from "../../lib/api";

const OFFICIAL_IP_LOOKUP_URL = "https://ipaddress.fnknock.cn/api/v1";
const OFFICIAL_CIDR_URL = "https://cidr.wxlnk.com/api/v1";
const DEFAULT_CUSTOM_IP_LOOKUP_URL = "http://127.0.0.1:30661";
const DEFAULT_CUSTOM_CIDR_URL = "http://127.0.0.1:30662";
const ipLookupDockerUrl = "https://hub.docker.com/r/kcilnk/go-ipaddress-api";
const cidrDockerUrl = "https://hub.docker.com/r/kcilnk/go-cidr-api";

const settings = ref<IpLocationApiConfig | null>(null);
const form = reactive<
  Pick<IpLocationApiConfig, "ip_lookup_mode" | "cidr_mode">
>({
  ip_lookup_mode: "online",
  cidr_mode: "online",
});

const ipLookupUrlInput = ref("");
const cidrUrlInput = ref("");

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const applyDefaultCustomUrls = () => {
  if (
    form.ip_lookup_mode === "custom" &&
    !normalizeBaseUrl(ipLookupUrlInput.value)
  ) {
    ipLookupUrlInput.value = DEFAULT_CUSTOM_IP_LOOKUP_URL;
  }

  if (form.cidr_mode === "custom" && !normalizeBaseUrl(cidrUrlInput.value)) {
    cidrUrlInput.value = DEFAULT_CUSTOM_CIDR_URL;
  }
};

const buildPayload = (): IpLocationApiConfig => ({
  ip_lookup_mode: form.ip_lookup_mode,
  ip_lookup_url:
    form.ip_lookup_mode === "custom"
      ? normalizeBaseUrl(ipLookupUrlInput.value)
      : OFFICIAL_IP_LOOKUP_URL,
  cidr_mode: form.cidr_mode,
  cidr_url:
    form.cidr_mode === "custom"
      ? normalizeBaseUrl(cidrUrlInput.value)
      : OFFICIAL_CIDR_URL,
});

const currentPayload = computed(buildPayload);

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const validateCustomUrls = (payload: IpLocationApiConfig) => {
  if (payload.ip_lookup_mode === "custom") {
    if (!payload.ip_lookup_url) {
      toast.error("请填写 IP 识别库地址");
      return false;
    }
    if (!isHttpUrl(payload.ip_lookup_url)) {
      toast.error("IP 识别库地址格式不正确", {
        description: "请输入以 http:// 或 https:// 开头的服务地址。",
      });
      return false;
    }
  }

  if (payload.cidr_mode === "custom") {
    if (!payload.cidr_url) {
      toast.error("请填写 CIDR 地址库地址");
      return false;
    }
    if (!isHttpUrl(payload.cidr_url)) {
      toast.error("CIDR 地址库地址格式不正确", {
        description: "请输入以 http:// 或 https:// 开头的服务地址。",
      });
      return false;
    }
  }

  return true;
};

const { isPending: isLoading, run: runLoadSettings } = useAsyncAction({
  onError: (error) => {
    toast.error("加载失败", {
      description: extractErrorMessage(error, "无法获取属地设置"),
    });
  },
});
const showLoadingSkeleton = useDelayedLoading(isLoading);

const { isPending: isSaving, run: runSaveSettings } = useAsyncAction({
  onError: (error) => {
    toast.error("保存失败", {
      description: extractErrorMessage(error, "属地设置保存失败"),
    });
  },
});

const { isPending: isTestingIpLookup, run: runTestIpLookup } = useAsyncAction({
  onError: (error) => {
    toast.error("连接失败", {
      description: extractErrorMessage(error, "IP识别库服务不可用"),
    });
  },
});

const { isPending: isTestingCidr, run: runTestCidr } = useAsyncAction({
  onError: (error) => {
    toast.error("连接失败", {
      description: extractErrorMessage(error, "CIDR库服务不可用"),
    });
  },
});

const isDirty = computed(() => {
  if (!settings.value) return false;
  const payload = currentPayload.value;
  return (
    settings.value.ip_lookup_mode !== payload.ip_lookup_mode ||
    settings.value.ip_lookup_url !== payload.ip_lookup_url ||
    settings.value.cidr_mode !== payload.cidr_mode ||
    settings.value.cidr_url !== payload.cidr_url
  );
});

const applyFromSettings = (data: IpLocationApiConfig) => {
  const normalized: IpLocationApiConfig = {
    ip_lookup_mode: data.ip_lookup_mode,
    ip_lookup_url: normalizeBaseUrl(data.ip_lookup_url),
    cidr_mode: data.cidr_mode,
    cidr_url: normalizeBaseUrl(data.cidr_url),
  };

  settings.value = normalized;
  form.ip_lookup_mode = normalized.ip_lookup_mode;
  form.cidr_mode = normalized.cidr_mode;
  ipLookupUrlInput.value =
    normalized.ip_lookup_mode === "custom" ? normalized.ip_lookup_url : "";
  cidrUrlInput.value =
    normalized.cidr_mode === "custom" ? normalized.cidr_url : "";
  applyDefaultCustomUrls();
};

const fetchSettings = async () => {
  await runLoadSettings(async () => {
    const data = await IpLocationSettingsAPI.getSettings();
    applyFromSettings(data);
  });
};

const resetForm = () => {
  if (settings.value) applyFromSettings(settings.value);
};

const testIpLookupService = async () => {
  const url = normalizeBaseUrl(ipLookupUrlInput.value);
  if (!url) {
    toast.error("请先输入 IP 识别库地址");
    return;
  }
  if (!isHttpUrl(url)) {
    toast.error("IP 识别库地址格式不正确", {
      description: "请输入以 http:// 或 https:// 开头的服务地址。",
    });
    return;
  }

  await runTestIpLookup(async () => {
    const result = await IpLocationSettingsAPI.testIpLookup(url);
    if (result.success) {
      toast.success("连接成功", { description: "IP 识别库服务响应正常" });
    } else {
      toast.error("连接失败", { description: result.message });
    }
  });
};

const testCidrService = async () => {
  const url = normalizeBaseUrl(cidrUrlInput.value);
  if (!url) {
    toast.error("请先输入 CIDR 地址库地址");
    return;
  }
  if (!isHttpUrl(url)) {
    toast.error("CIDR 地址库地址格式不正确", {
      description: "请输入以 http:// 或 https:// 开头的服务地址。",
    });
    return;
  }

  await runTestCidr(async () => {
    const result = await IpLocationSettingsAPI.testCidr(url);
    if (result.success) {
      toast.success("连接成功", { description: "CIDR 地址库服务响应正常" });
    } else {
      toast.error("连接失败", { description: result.message });
    }
  });
};

const saveSettings = async () => {
  const payload = currentPayload.value;
  if (!validateCustomUrls(payload)) return;

  await runSaveSettings(() => IpLocationSettingsAPI.updateSettings(payload), {
    onSuccess: (data) => {
      applyFromSettings(data);
      toast.success("属地设置已更新");
    },
  });
};

watch(
  () => [form.ip_lookup_mode, form.cidr_mode] as const,
  applyDefaultCustomUrls,
);

onMounted(fetchSettings);
</script>

<template>
  <div class="w-full max-w-5xl space-y-4">
    <div
      v-if="isLoading && showLoadingSkeleton"
      class="grid gap-4 xl:grid-cols-2"
    >
      <section class="rounded-xl border bg-card p-5 shadow-sm">
        <div class="flex gap-3">
          <Skeleton class="size-10 rounded-lg" />
          <div class="flex-1 space-y-2">
            <Skeleton class="h-5 w-32" />
            <Skeleton class="h-4 w-4/5" />
          </div>
        </div>
        <div class="mt-6 space-y-3">
          <Skeleton class="h-4 w-24" />
          <Skeleton class="h-9 w-full" />
          <Skeleton class="h-20 w-full" />
        </div>
      </section>
      <section class="rounded-xl border bg-card p-5 shadow-sm">
        <div class="flex gap-3">
          <Skeleton class="size-10 rounded-lg" />
          <div class="flex-1 space-y-2">
            <Skeleton class="h-5 w-32" />
            <Skeleton class="h-4 w-4/5" />
          </div>
        </div>
        <div class="mt-6 space-y-3">
          <Skeleton class="h-4 w-24" />
          <Skeleton class="h-9 w-full" />
          <Skeleton class="h-20 w-full" />
        </div>
      </section>
    </div>

    <div v-else-if="!isLoading" class="grid gap-4 xl:grid-cols-1">
      <section class="flex min-h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
        <div class="border-b bg-muted/10 p-4 sm:p-5">
          <div class="flex gap-3">
            <div class="min-w-0 space-y-1">
              <h3 class="text-base font-semibold tracking-normal">IP 识别库</h3>
              <p class="text-sm leading-6 text-muted-foreground">
                查询单个 IP 的国家、地区和运营商信息。
              </p>
            </div>
          </div>
        </div>

        <div class="flex w-full flex-1 flex-col gap-5 p-4 sm:p-5">
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-3">
              <Label for="ip-location-lookup-mode" class="text-sm font-medium">
                服务来源
              </Label>
            </div>
            <Select v-model="form.ip_lookup_mode" :disabled="isSaving">
              <SelectTrigger id="ip-location-lookup-mode" class="w-full">
                <SelectValue placeholder="选择服务来源" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="online">官方在线服务</SelectItem>
                <SelectItem value="custom">自定义服务</SelectItem>
              </SelectContent>
            </Select>
            <p class="text-sm leading-6 text-muted-foreground">
              官方服务适合直接使用；自定义服务适合内网、离线或私有化部署。
            </p>
          </div>

          <div
            v-if="form.ip_lookup_mode === 'online'"
            class="mt-auto rounded-lg border border-dashed bg-muted/20 p-4"
          >
            <div class="flex gap-3">
              <CheckCircle2 class="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <div class="min-w-0 space-y-1">
                <p class="text-sm font-medium">当前使用官方在线服务</p>
              </div>
            </div>
          </div>

          <div
            v-if="form.ip_lookup_mode === 'custom'"
            class="animate-in fade-in slide-in-from-top-2 space-y-4 duration-200"
          >
            <div class="rounded-lg border bg-muted/20 p-4">
              <div class="flex gap-3">
                <div class="space-y-1 text-sm">
                  <p class="font-medium">自部署服务</p>
                  <p class="leading-6 text-muted-foreground">
                    可使用
                    <a
                      :href="ipLookupDockerUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      go-ipaddress-api
                      <ExternalLink class="size-3.5" />
                    </a>
                    部署。
                  </p>
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <Label for="ip-location-lookup-url" class="text-sm font-medium">
                Base URL
              </Label>
              <div class="flex flex-col gap-2 sm:flex-row">
                <InputGroup class="sm:flex-1">
                  <InputGroupInput
                    id="ip-location-lookup-url"
                    v-model="ipLookupUrlInput"
                    placeholder="比如：http://localhost:30661"
                    :disabled="isSaving"
                  />
                </InputGroup>
                <Button
                  variant="outline"
                  class="w-full sm:w-auto"
                  :disabled="isTestingIpLookup || !ipLookupUrlInput.trim()"
                  @click="testIpLookupService"
                >
                  <LoaderCircle
                    v-if="isTestingIpLookup"
                    class="size-4 animate-spin"
                  />
                  <Link2 v-else class="size-4" />
                  {{ isTestingIpLookup ? "测试中" : "测试连接" }}
                </Button>
              </div>
              <p class="text-xs text-muted-foreground">
                填写服务根地址，保存时会自动去掉末尾斜杠。
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="flex min-h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
        <div class="border-b bg-muted/10 p-4 sm:p-5">
          <div class="flex gap-3">
            <div class="min-w-0 space-y-1">
              <h3 class="text-base font-semibold tracking-normal">CIDR 地址库</h3>
              <p class="text-sm leading-6 text-muted-foreground">
                查询省市级 IP 地址段，供白名单和地区选择器使用。
              </p>
            </div>
          </div>
        </div>

        <div class="flex w-full flex-1 flex-col gap-5 p-4 sm:p-5">
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-3">
              <Label for="ip-location-cidr-mode" class="text-sm font-medium">
                服务来源
              </Label>
            </div>
            <Select v-model="form.cidr_mode" :disabled="isSaving">
              <SelectTrigger id="ip-location-cidr-mode" class="w-full">
                <SelectValue placeholder="选择服务来源" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="online">官方在线服务</SelectItem>
                <SelectItem value="custom">自定义服务</SelectItem>
              </SelectContent>
            </Select>
            <p class="text-sm leading-6 text-muted-foreground">
              官方服务会自动更新地域数据；自定义服务适合固定数据源或内网部署。
            </p>
          </div>

          <div
            v-if="form.cidr_mode === 'online'"
            class="mt-auto rounded-lg border border-dashed bg-muted/20 p-4"
          >
            <div class="flex gap-3">
              <CheckCircle2 class="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <div class="min-w-0 space-y-1">
                <p class="text-sm font-medium">当前使用官方在线服务</p>
              </div>
            </div>
          </div>

          <div
            v-if="form.cidr_mode === 'custom'"
            class="animate-in fade-in slide-in-from-top-2 space-y-4 duration-200"
          >
            <div class="rounded-lg border bg-muted/20 p-4">
              <div class="flex gap-3">
                <div class="space-y-1 text-sm">
                  <p class="font-medium">自部署服务</p>
                  <p class="leading-6 text-muted-foreground">
                    可使用
                  <a
                    :href="cidrDockerUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    go-cidr-api
                    <ExternalLink class="size-3.5" />
                  </a>
                  部署。
                  </p>
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <Label for="ip-location-cidr-url" class="text-sm font-medium">
                Base URL
              </Label>
              <div class="flex flex-col gap-2 sm:flex-row">
                <InputGroup class="sm:flex-1">
                  <InputGroupInput
                    id="ip-location-cidr-url"
                    v-model="cidrUrlInput"
                    placeholder="比如：http://localhost:30662"
                    :disabled="isSaving"
                  />
                </InputGroup>
                <Button
                  variant="outline"
                  class="w-full sm:w-auto"
                  :disabled="isTestingCidr || !cidrUrlInput.trim()"
                  @click="testCidrService"
                >
                  <LoaderCircle
                    v-if="isTestingCidr"
                    class="size-4 animate-spin"
                  />
                  <Link2 v-else class="size-4" />
                  {{ isTestingCidr ? "测试中" : "测试连接" }}
                </Button>
              </div>
              <p class="text-xs text-muted-foreground">
                填写服务根地址，保存时会自动去掉末尾斜杠。
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-else class="min-h-[220px] rounded-xl border bg-card" aria-hidden="true" />

    <section class="rounded-xl border bg-card px-4 py-4 shadow-sm sm:px-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <div class="flex gap-3">
          <Button
            variant="outline"
            class="flex-1 sm:flex-none"
            @click="resetForm"
            :disabled="!isDirty || isSaving"
          >
            <RotateCcw class="size-4" />
            放弃
          </Button>
          <Button
            class="flex-1 sm:flex-none"
            :disabled="!isDirty || isSaving"
            @click="saveSettings"
          >
            <LoaderCircle v-if="isSaving" class="size-4 animate-spin" />
            <Save v-else class="size-4" />
            {{ isSaving ? "保存中" : "保存更改" }}
          </Button>
        </div>
      </div>
    </section>
  </div>
</template>
