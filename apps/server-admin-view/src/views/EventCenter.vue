<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSyncedQueryTab } from "@admin-shared/composables/useSyncedQueryTab";
import EventsTab from "./event-center/EventsTab.vue";
import NotificationsTab from "./event-center/NotificationsTab.vue";

const router = useRouter();
const route = useRoute();

const { currentTab, navigateTo } = useSyncedQueryTab({
  route,
  router,
  defaultTab: "events",
  allowedTabs: ["events", "notifications"],
});
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <div class="space-y-1">
      <div class="text-xl font-semibold tracking-tight text-foreground">
        事件中心
      </div>
      <div class="text-sm leading-6 text-muted-foreground">
        统一查看系统事件，并基于事件流配置通知提供商、告警规则与投递记录。
      </div>
    </div>

    <Tabs
      :model-value="currentTab"
      @update:model-value="navigateTo"
      class="flex flex-1 flex-col"
    >
      <TabsList class="w-fit">
        <TabsTrigger value="events">事件</TabsTrigger>
        <TabsTrigger value="notifications">通知</TabsTrigger>
      </TabsList>

      <TabsContent value="events" class="min-h-0 flex-1 pt-2">
        <EventsTab />
      </TabsContent>

      <TabsContent value="notifications" class="min-h-0 flex-1 pt-2">
        <NotificationsTab />
      </TabsContent>
    </Tabs>
  </div>
</template>
