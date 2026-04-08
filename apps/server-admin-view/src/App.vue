<script setup lang="ts">
import { Toaster } from "@/components/ui/sonner";
import { extractErrorMessage } from "@admin-shared/composables/useAsyncAction";
import { toast } from "@admin-shared/utils/toast";
import { computed, onMounted, ref } from "vue";
import "vue-sonner/style.css";
import WelcomeScreen from "./components/WelcomeScreen.vue";
import { ConfigAPI } from "./lib/api";

const WELCOME_GUIDE_STORAGE_KEY = "fn_knock:welcome-guide:completed";

const readWelcomeGuideLocalFlag = () => {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(WELCOME_GUIDE_STORAGE_KEY) === "1";
};

const writeWelcomeGuideLocalFlag = () => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WELCOME_GUIDE_STORAGE_KEY, "1");
};

const hasLocalWelcomeGuideCompletion = readWelcomeGuideLocalFlag();
const isWelcomeVisible = ref(false);
const isWelcomeResolved = ref(hasLocalWelcomeGuideCompletion);
const isSavingWelcomeStatus = ref(false);
const showWelcomeBootMask = computed(
  () => !isWelcomeResolved.value && !isWelcomeVisible.value,
);

const loadWelcomeGuideStatus = async () => {
  try {
    const status = await ConfigAPI.getWelcomeGuideStatus();
    if (status.completed === true) {
      writeWelcomeGuideLocalFlag();
      isWelcomeVisible.value = false;
      return;
    }

    isWelcomeVisible.value = true;
  } catch (error) {
    console.error("Failed to load welcome guide status", error);
    isWelcomeVisible.value = false;
  } finally {
    isWelcomeResolved.value = true;
  }
};

const syncWelcomeGuideCompletion = async (showErrorToast: boolean) => {
  if (isSavingWelcomeStatus.value) return;

  isSavingWelcomeStatus.value = true;
  try {
    await ConfigAPI.completeWelcomeGuide();
  } catch (error) {
    console.error("Failed to save welcome guide status", error);
    if (showErrorToast) {
      toast.error("保存欢迎向导状态失败", {
        description: extractErrorMessage(error, "请稍后重试"),
      });
    }
  } finally {
    isSavingWelcomeStatus.value = false;
  }
};

const handleWelcomeStart = () => {
  writeWelcomeGuideLocalFlag();
  isWelcomeResolved.value = true;
  isWelcomeVisible.value = false;
  void syncWelcomeGuideCompletion(false);
};

onMounted(() => {
  if (hasLocalWelcomeGuideCompletion) {
    void syncWelcomeGuideCompletion(false);
    return;
  }

  void loadWelcomeGuideStatus();
});
</script>

<template>
  <RouterView />
  <div v-if="showWelcomeBootMask" class="welcome-boot-mask"></div>
  <WelcomeScreen
    :visible="isWelcomeVisible"
    :pending="isSavingWelcomeStatus"
    @start="handleWelcomeStart"
  />
  <Toaster position="top-center" :duration="3000" />
</template>

<style scoped>
.welcome-boot-mask {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background:
    radial-gradient(circle at 18% 18%, rgba(118, 164, 255, 0.18), transparent 28%),
    radial-gradient(circle at 82% 24%, rgba(255, 159, 237, 0.14), transparent 24%),
    linear-gradient(180deg, rgba(8, 10, 18, 0.98), rgba(8, 10, 18, 0.92));
}
</style>
