<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { toast } from "@admin-shared/utils/toast";
import {
  useAsyncAction,
  extractErrorMessage,
} from "@admin-shared/composables/useAsyncAction";
import { parseCidrTextarea } from "@admin-shared/utils/cidr";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  TagsInput,
  TagsInputItem,
  TagsInputItemDelete,
  TagsInputItemText,
} from "@/components/ui/tags-input";
import { Textarea } from "@/components/ui/textarea";
import { CidrAPI, ConfigAPI } from "../../lib/api";
import type {
  CidrCityOption,
  CidrProvinceOption,
  GatewayVisibilityDetails,
  GatewayVisibilitySelection,
} from "../../types";

const settings = ref<GatewayVisibilityDetails | null>(null);
const provinces = ref<CidrProvinceOption[]>([]);
const cityOptions = ref<CidrCityOption[]>([]);
const loadError = ref("");
const cityOptionsLoading = ref(false);
const isSelectionDialogOpen = ref(false);

const draft = reactive({
  province: "",
  cityValue: "",
});

const form = reactive({
  enabled: false,
  selections: [] as GatewayVisibilitySelection[],
  customCidrsText: "",
});

let cityRequestToken = 0;

const selectionKey = (selection: {
  province: string;
  query_city?: string | null;
}) => `${selection.province}::${selection.query_city ?? ""}`;

const customCidrsState = computed(() =>
  parseCidrTextarea(form.customCidrsText),
);

const customCidrCount = computed(() => customCidrsState.value.cidrs.length);
const invalidCustomCidrs = computed(() => customCidrsState.value.invalid);
const visibilityInputsDisabled = computed(
  () => isSaving.value || !form.enabled,
);

const hasVisibleTargets = computed(
  () => form.selections.length > 0 || customCidrsState.value.cidrs.length > 0,
);

const selectedCityOption = computed(
  () =>
    cityOptions.value.find((option) => option.value === draft.cityValue) ??
    null,
);

const citySelectKey = computed(() => draft.province || "empty");

const citySelectPlaceholder = computed(() => {
  if (cityOptionsLoading.value) return "正在加载...";
  if (!draft.province) return "先选择省份";
  return cityOptions.value.some((option) => option.isProvinceWide)
    ? "选择城市或全省"
    : "选择城市";
});

const pendingSelectionExists = computed(() => {
  const city = selectedCityOption.value;
  if (!draft.province || !city) return false;
  return form.selections.some(
    (item) =>
      selectionKey(item) ===
      selectionKey({
        province: draft.province,
        query_city: city.queryCity,
      }),
  );
});

const canAddSelection = computed(
  () =>
    form.enabled &&
    Boolean(draft.province) &&
    Boolean(selectedCityOption.value) &&
    !pendingSelectionExists.value &&
    !cityOptionsLoading.value,
);

const formSnapshot = computed(() =>
  JSON.stringify({
    enabled: form.enabled,
    selections: form.selections.map((item) => selectionKey(item)),
    custom_cidrs: customCidrsState.value.cidrs,
  }),
);

const savedSnapshot = computed(() =>
  JSON.stringify({
    enabled: settings.value?.config.enabled ?? false,
    selections: (settings.value?.config.selections ?? []).map((item) =>
      selectionKey(item),
    ),
    custom_cidrs: settings.value?.config.custom_cidrs ?? [],
  }),
);

const isDirty = computed(() => formSnapshot.value !== savedSnapshot.value);

const saveBlockedReason = computed(() => {
  if (invalidCustomCidrs.value.length > 0) {
    return "请先修正自定义 CIDR 中的格式错误";
  }
  if (form.enabled && !hasVisibleTargets.value) {
    return "启用可见性后，至少需要一个地区或一条自定义 CIDR";
  }
  return "";
});

const { isPending: isLoading, run: runLoad } = useAsyncAction({
  onError: (error) => {
    loadError.value = extractErrorMessage(error, "加载可见性配置失败");
  },
});

const { isPending: isSaving, run: runSave } = useAsyncAction({
  onError: (error) => {
    toast.error("保存失败", {
      description: extractErrorMessage(error, "保存可见性配置失败"),
    });
  },
});

const applyDetails = (details: GatewayVisibilityDetails) => {
  settings.value = {
    config: {
      enabled: details.config.enabled,
      selections: details.config.selections.map((item) => ({ ...item })),
      custom_cidrs: [...details.config.custom_cidrs],
    },
    summary: { ...details.summary },
  };

  form.enabled = details.config.enabled;
  form.selections = details.config.selections.map((item) => ({ ...item }));
  form.customCidrsText = details.config.custom_cidrs.join("\n");
};

const clearSelectionDraft = () => {
  cityRequestToken += 1;
  cityOptionsLoading.value = false;
  draft.province = "";
  draft.cityValue = "";
  cityOptions.value = [];
};

const prepareSelectionDraft = () => {
  const preferredProvince =
    form.selections[0]?.province || provinces.value[0]?.value || "";

  clearSelectionDraft();

  if (preferredProvince) {
    draft.province = preferredProvince;
  }
};

const openSelectionDialog = () => {
  if (visibilityInputsDisabled.value || provinces.value.length === 0) {
    return;
  }

  isSelectionDialogOpen.value = true;
  prepareSelectionDraft();
};

const handleSelectionDialogOpenChange = (nextOpen: boolean) => {
  isSelectionDialogOpen.value = nextOpen;

  if (!nextOpen) {
    clearSelectionDraft();
  }
};

const loadCityOptions = async (province: string) => {
  if (!province) {
    cityOptions.value = [];
    draft.cityValue = "";
    return;
  }

  const token = ++cityRequestToken;
  cityOptionsLoading.value = true;
  cityOptions.value = [];
  draft.cityValue = "";
  try {
    const payload = await CidrAPI.getCities(province);
    if (token !== cityRequestToken) return;

    cityOptions.value = payload.options;
    const hasCurrentValue = payload.options.some(
      (item) => item.value === draft.cityValue,
    );
    draft.cityValue = hasCurrentValue
      ? draft.cityValue
      : (payload.defaultValue ?? payload.options[0]?.value ?? "");
  } catch (error) {
    if (token !== cityRequestToken) return;
    cityOptions.value = [];
    draft.cityValue = "";
    toast.error("地区列表加载失败", {
      description: extractErrorMessage(error, "无法获取省份下的城市列表"),
    });
  } finally {
    if (token === cityRequestToken) {
      cityOptionsLoading.value = false;
    }
  }
};

watch(
  () => draft.province,
  (province, previousProvince) => {
    if (province !== previousProvince) {
      if (!province) {
        draft.cityValue = "";
        cityOptions.value = [];
        return;
      }
      void loadCityOptions(province);
    }
  },
);

watch(
  () => form.enabled,
  (enabled) => {
    if (!enabled) {
      handleSelectionDialogOpenChange(false);
    }
  },
);

const fetchDetails = async () => {
  await runLoad(async () => {
    loadError.value = "";
    const [provincePayload, details] = await Promise.all([
      CidrAPI.getProvinces(),
      ConfigAPI.getGatewayVisibility(),
    ]);

    provinces.value = provincePayload.options;
    applyDetails(details);
  });
};

const resetForm = () => {
  if (!settings.value) return;
  applyDetails(settings.value);
  handleSelectionDialogOpenChange(false);
};

const addSelection = () => {
  const option = selectedCityOption.value;
  if (!draft.province || !option || pendingSelectionExists.value) {
    return;
  }

  form.selections.push({
    province: draft.province,
    city: option.isProvinceWide ? null : option.label,
    label: option.label,
    value: option.value,
    query_city: option.queryCity,
    is_province_wide: option.isProvinceWide,
    is_municipality: option.isMunicipality,
  });

  handleSelectionDialogOpenChange(false);
};

const removeSelection = (selection: GatewayVisibilitySelection) => {
  if (visibilityInputsDisabled.value) {
    return;
  }

  form.selections = form.selections.filter(
    (item) => selectionKey(item) !== selectionKey(selection),
  );
};

const saveSettings = async () => {
  if (invalidCustomCidrs.value.length > 0) {
    toast.error("CIDR 校验未通过", {
      description: `请修正这些条目：${invalidCustomCidrs.value.join("、")}`,
    });
    return;
  }

  if (form.enabled && !hasVisibleTargets.value) {
    toast.error("至少需要一条可见性规则", {
      description: "启用可见性后，至少需要一个地区或一条自定义 CIDR。",
    });
    return;
  }

  await runSave(
    () =>
      ConfigAPI.updateGatewayVisibility({
        enabled: form.enabled,
        selections: form.selections.map((item) => ({
          province: item.province,
          query_city: item.query_city,
        })),
        custom_cidrs: customCidrsState.value.cidrs,
      }),
    {
      onSuccess: async (details) => {
        applyDetails(details);
        toast.success("网关可见性已更新");
      },
    },
  );
};

onMounted(() => {
  void fetchDetails();
});
</script>

<template>
  <div class="space-y-6">
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#/system">系统设置</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#/system?tab=gateway">网关</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>可见性</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <Card class="border-border/60 shadow-none">
      <CardHeader class="space-y-3">
        <div class="space-y-1.5">
          <CardTitle class="text-xl">可见性</CardTitle>
          <CardDescription class="max-w-3xl leading-6">
            选择允许访问网关的地区范围，启用后，不在名单范围内的请求将被直接阻断
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent class="space-y-6">
        <div
          v-if="isLoading"
          class="rounded-xl border border-border/60 bg-muted/20 px-5 py-12 text-center text-sm text-muted-foreground"
        >
          正在加载可见性配置...
        </div>

        <div
          v-else-if="loadError"
          class="rounded-xl border border-destructive/25 bg-destructive/5 px-5 py-4 text-sm text-destructive"
        >
          {{ loadError }}
        </div>

        <template v-else>
          <div class="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0 space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <Label class="text-base font-medium">可见性约束</Label>
                </div>
              </div>

              <Switch
                v-model="form.enabled"
                class="mt-0.5 shrink-0"
                :disabled="isSaving"
              />
            </div>
          </div>

          <div class="overflow-hidden rounded-xl border border-border/60">
            <template v-if="form.enabled">
              <section class="space-y-4 p-5">
                <div
                  class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div class="space-y-1">
                    <Label class="text-base">地区范围</Label>
                    <p class="text-sm leading-6 text-muted-foreground">
                      按省市添加允许访问的地区，保存时再解析为最终 CIDR。
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="
                      visibilityInputsDisabled || provinces.length === 0
                    "
                    @click="openSelectionDialog"
                  >
                    添加地区
                  </Button>
                </div>

                <div class="rounded-xl bg-muted/20 px-4 py-4">
                  <TagsInput
                    :model-value="
                      form.selections.map((item) => selectionKey(item))
                    "
                    class="min-h-0 items-start gap-2 border-none bg-transparent px-0 py-0 shadow-none"
                  >
                    <template v-if="form.selections.length > 0">
                      <TagsInputItem
                        v-for="selection in form.selections"
                        :key="selectionKey(selection)"
                        :value="selectionKey(selection)"
                        class="h-auto rounded-full border border-border/70 bg-background pr-1"
                      >
                        <TagsInputItemText class="px-3 py-1.5">
                          {{ selection.label }}
                        </TagsInputItemText>
                        <TagsInputItemDelete
                          v-if="form.enabled"
                          class="mr-1 rounded-full hover:bg-muted"
                          @click.prevent="removeSelection(selection)"
                        />
                      </TagsInputItem>
                    </template>

                    <div v-else class="px-1 py-1 text-sm text-muted-foreground">
                      还没有添加任何地区。
                    </div>
                  </TagsInput>
                </div>
              </section>

              <section class="space-y-4 border-t border-border/60 p-5">
                <div class="space-y-1">
                  <Label class="text-base">自定义 CIDR</Label>
                  <p class="text-sm leading-6 text-muted-foreground">
                    每行一条，例如 <code>1.2.3.0/24</code> 或
                    <code>2408:8000::/24</code>。
                  </p>
                </div>

                <Textarea
                  v-model="form.customCidrsText"
                  :disabled="visibilityInputsDisabled"
                  class="min-h-36 font-mono text-sm"
                  placeholder="每行一个 CIDR"
                />

                <div class="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                  <span class="text-muted-foreground">
                    已识别 {{ customCidrCount }} 条自定义 CIDR
                  </span>
                  <span
                    v-if="invalidCustomCidrs.length > 0"
                    class="text-destructive"
                  >
                    格式错误：{{ invalidCustomCidrs.join("、") }}
                  </span>
                  <span v-else class="text-emerald-600">
                    当前输入格式校验通过
                  </span>
                </div>
              </section>
            </template>

            <section class="space-y-4 p-5">
              <div class="flex flex-wrap items-center justify-end gap-3">
                <Button
                  variant="outline"
                  :disabled="!isDirty || isSaving"
                  @click="resetForm"
                >
                  重置
                </Button>
                <Button
                  :disabled="!isDirty || isSaving || Boolean(saveBlockedReason)"
                  @click="saveSettings"
                >
                  <span
                    v-if="isSaving"
                    class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-foreground"
                  ></span>
                  {{ isSaving ? "保存并同步中..." : "保存并同步" }}
                </Button>
              </div>
            </section>
          </div>
        </template>
      </CardContent>
    </Card>

    <Dialog
      :open="isSelectionDialogOpen"
      @update:open="handleSelectionDialogOpenChange"
    >
      <DialogContent
        class="overflow-hidden border-border/70 bg-background p-0 shadow-xl sm:max-w-[560px]"
      >
        <div class="px-6 pt-6 pb-2">
          <DialogHeader class="space-y-2 text-left">
            <DialogTitle class="text-xl font-semibold tracking-tight">
              添加地区
            </DialogTitle>
            <DialogDescription class="text-sm leading-6 text-muted-foreground">
              选择省份和城市范围。
            </DialogDescription>
          </DialogHeader>
        </div>

        <div class="space-y-4 border-t border-border/60 px-6 py-5">
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label class="text-sm font-medium">省份</Label>
              <Select v-model="draft.province">
                <SelectTrigger
                  class="h-11 w-full rounded-lg border-border/70 bg-background px-3 shadow-none"
                  :disabled="isSaving || provinces.length === 0"
                >
                  <SelectValue placeholder="选择省份" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="province in provinces"
                    :key="province.value"
                    :value="province.value"
                  >
                    {{ province.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="space-y-2">
              <Label class="text-sm font-medium">范围</Label>
              <Select :key="citySelectKey" v-model="draft.cityValue">
                <SelectTrigger
                  class="h-11 w-full rounded-lg border-border/70 bg-background px-3 shadow-none"
                  :disabled="
                    isSaving ||
                    !draft.province ||
                    cityOptionsLoading ||
                    cityOptions.length === 0
                  "
                >
                  <span
                    v-if="cityOptionsLoading"
                    class="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-foreground"
                  ></span>
                  <SelectValue :placeholder="citySelectPlaceholder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="city in cityOptions"
                    :key="city.value"
                    :value="city.value"
                  >
                    {{ city.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter
          class="border-t border-border/60 px-6 py-4 sm:justify-end"
        >
          <Button
            variant="outline"
            @click="handleSelectionDialogOpenChange(false)"
          >
            取消
          </Button>
          <Button
            :disabled="!canAddSelection || isSaving"
            @click="addSelection"
          >
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
