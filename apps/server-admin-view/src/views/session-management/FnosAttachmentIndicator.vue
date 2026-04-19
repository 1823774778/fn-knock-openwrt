<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import fnosIconUrl from "@/assets/fnos.png";
import type { SessionAppAttachmentRecord } from "../../types";
import { formatHumanFriendlyTime } from "@admin-shared/utils/formatHumanFriendlyTime";

const props = withDefaults(
  defineProps<{
    attachments: SessionAppAttachmentRecord[];
    iconUrl?: string;
    iconAlt?: string;
    title?: string;
    triggerLabel?: string;
    itemLabel?: string;
    footerText?: string;
  }>(),
  {
    iconAlt: "飞牛",
    title: "附着的飞牛token",
    triggerLabel: "飞牛token",
    itemLabel: "token",
    footerText: "包括网页与飞牛App的会话附着都会在此显示",
  },
);

const open = ref(false);
const isTouchInteraction = ref(false);
const isPointerOnTrigger = ref(false);
const isPointerOnContent = ref(false);

let interactionMediaQuery: MediaQueryList | null = null;
let closeTimer: number | null = null;

const orderedAttachments = computed(() => {
  return [...props.attachments].sort((a, b) => {
    return (Date.parse(b.lastSeenAt) || 0) - (Date.parse(a.lastSeenAt) || 0);
  });
});

const attachmentCount = computed(() => orderedAttachments.value.length);

const resolvedIconUrl = computed(() => props.iconUrl || fnosIconUrl);

const updateInteractionMode = () => {
  if (typeof window === "undefined") {
    return;
  }

  isTouchInteraction.value = window.matchMedia(
    "(hover: none), (pointer: coarse)",
  ).matches;
};

const clearCloseTimer = () => {
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
};

const scheduleClose = () => {
  clearCloseTimer();
  closeTimer = window.setTimeout(() => {
    if (!isPointerOnTrigger.value && !isPointerOnContent.value) {
      open.value = false;
    }
    closeTimer = null;
  }, 180);
};

const handleOpenChange = (nextOpen: boolean) => {
  if (nextOpen) {
    open.value = true;
    return;
  }

  if (isTouchInteraction.value) {
    open.value = false;
    return;
  }

  if (!isPointerOnTrigger.value && !isPointerOnContent.value) {
    open.value = false;
  }
};

const handleTriggerEnter = () => {
  if (isTouchInteraction.value) {
    return;
  }

  isPointerOnTrigger.value = true;
  clearCloseTimer();
  open.value = true;
};

const handleTriggerLeave = () => {
  if (isTouchInteraction.value) {
    return;
  }

  isPointerOnTrigger.value = false;
  scheduleClose();
};

const handleContentEnter = () => {
  if (isTouchInteraction.value) {
    return;
  }

  isPointerOnContent.value = true;
  clearCloseTimer();
  open.value = true;
};

const handleContentLeave = () => {
  if (isTouchInteraction.value) {
    return;
  }

  isPointerOnContent.value = false;
  scheduleClose();
};

const handleTriggerClick = () => {
  if (!isTouchInteraction.value) {
    open.value = true;
    return;
  }

  open.value = !open.value;
};

const formatRelativeTime = (
  value: string | null | undefined,
  emptyText = "-",
  locale = "zh-CN",
) => {
  return formatHumanFriendlyTime(value, {
    locale,
    emptyText,
  });
};

watch(
  () => props.attachments.length,
  (length) => {
    if (length === 0) {
      open.value = false;
    }
  },
);

onMounted(() => {
  if (typeof window === "undefined") {
    return;
  }

  interactionMediaQuery = window.matchMedia("(hover: none), (pointer: coarse)");
  updateInteractionMode();

  if (typeof interactionMediaQuery.addEventListener === "function") {
    interactionMediaQuery.addEventListener("change", updateInteractionMode);
    return;
  }

  interactionMediaQuery.addListener(updateInteractionMode);
});

onUnmounted(() => {
  clearCloseTimer();

  if (!interactionMediaQuery) {
    return;
  }

  if (typeof interactionMediaQuery.removeEventListener === "function") {
    interactionMediaQuery.removeEventListener("change", updateInteractionMode);
    return;
  }

  interactionMediaQuery.removeListener(updateInteractionMode);
});
</script>

<template>
  <Popover :open="open" @update:open="handleOpenChange">
    <PopoverAnchor as-child>
      <button
        type="button"
        class="relative inline-flex h-7 w-7 shrink-0 items-center justify-center transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 touch-manipulation"
        :aria-label="`查看已 attach 的${props.triggerLabel}（${attachmentCount} 个）`"
        :aria-expanded="open"
        @mouseenter="handleTriggerEnter"
        @mouseleave="handleTriggerLeave"
        @click="handleTriggerClick"
      >
        <img
          :src="resolvedIconUrl"
          :alt="props.iconAlt"
          class="h-4 w-4 rounded-[4px] object-contain"
        />
        <span
          v-if="attachmentCount > 1"
          class="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-semibold leading-4 text-background"
        >
          {{ attachmentCount }}
        </span>
      </button>
    </PopoverAnchor>

    <PopoverContent
      side="bottom"
      align="start"
      class="w-[min(20rem,calc(100vw-1rem))] px-3 py-2.5"
      @mouseenter="handleContentEnter"
      @mouseleave="handleContentLeave"
    >
      <div class="flex items-center gap-2">
        <img
          :src="resolvedIconUrl"
          :alt="props.iconAlt"
          class="h-4 w-4 rounded-[4px] object-contain"
        />
        <div class="text-sm font-medium">{{ props.title }}</div>
        <div class="ml-auto text-xs text-muted-foreground">
          {{ attachmentCount }} 个
        </div>
      </div>

      <div class="mt-2 space-y-2">
        <div
          v-for="(attachment, index) in orderedAttachments"
          :key="attachment.subjectHash"
          class="border-t border-border/60 pt-2 first:border-t-0 first:pt-0"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="text-xs font-medium">
              {{ props.itemLabel }} {{ index + 1 }}
            </div>
            <div class="text-[11px] text-muted-foreground">
              活跃 {{ formatRelativeTime(attachment.lastSeenAt) }}
            </div>
          </div>

          <div
            class="mt-1 break-all font-mono text-[11px] leading-4 text-muted-foreground"
          >
            {{ attachment.subjectHash }}
          </div>

          <div class="mt-1.5 grid gap-1 text-[11px] text-muted-foreground">
            <div class="flex items-start gap-2">
              <span class="shrink-0">IP</span>
              <span class="break-all font-mono text-foreground">
                {{ attachment.currentIp }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="props.footerText"
        class="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground"
      >
        {{ props.footerText }}
      </div>
    </PopoverContent>
  </Popover>
</template>
