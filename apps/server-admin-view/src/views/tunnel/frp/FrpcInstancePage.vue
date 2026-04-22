<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ConfigAPI,
  FrpcAPI,
  type FrpcInstanceStatus,
  type FrpcInstanceSummary,
} from '../../../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Play, Save, Square, Trash2 } from 'lucide-vue-next'
import { toast } from '@admin-shared/utils/toast'
import LogViewer from '@admin-shared/components/LogViewer.vue'
import HumanFriendlyTime from '@admin-shared/components/common/HumanFriendlyTime.vue'
import { extractErrorMessage } from '@admin-shared/composables/useAsyncAction'
import { DEFAULT_LOG_WINDOW_SIZE, mergePollingLogWindow } from '@admin-shared/utils/log-window'
import { useConfigStore } from '../../../store/config'
import LiveStatusBadge from '../../../components/LiveStatusBadge.vue'
import { extractVisualFieldsFromToml } from '../../../lib/frpc-config-editor'
import FrpcInstanceEditor from './FrpcInstanceEditor.vue'

type FrpcEditorExpose = {
  getContent: () => string
  resetFromRaw: (raw: string) => void
}

const route = useRoute()
const router = useRouter()
const configStore = useConfigStore()

const instanceId = computed(() => String(route.params.id || ''))
const isCreateMode = computed(() => route.name === 'FrpcInstanceCreate')
const title = computed(() => (isCreateMode.value ? '新增 FRP' : getInstanceDisplayName(instance.value)))
const defaults = ref<{ local_port: string }>({ local_port: '7999' })
const instance = ref<FrpcInstanceStatus | null>(null)
const content = ref('')
const name = ref('')
const logs = ref<string[]>([])
const cursor = ref<number | undefined>(undefined)
const editorRef = ref<FrpcEditorExpose | null>(null)
const configSectionRef = ref<HTMLElement | null>(null)
const isLoading = ref(false)
const isSaving = ref(false)
const isStarting = ref(false)
const isStopping = ref(false)
const isClearingLogs = ref(false)

let pollTimer: number | null = null

const summary = computed(() =>
  instance.value?.summary ?? summarizeContent(content.value),
)
const shouldOpenLogs = computed(() => route.query.section === 'logs')
const shouldOpenConfig = computed(() => route.query.section === 'config')

function summarizeContent(raw: string): FrpcInstanceSummary {
  try {
    const fields = extractVisualFieldsFromToml(raw, { localPort: defaults.value.local_port })
    return {
      serverAddr: fields.serverAddr,
      serverPort: fields.serverPort,
      localPort: fields.localPort,
      remotePort: fields.remotePort,
    }
  } catch {
    return {
      serverAddr: '',
      serverPort: '7000',
      localPort: defaults.value.local_port,
      remotePort: '',
    }
  }
}

function formatSummary(value: FrpcInstanceSummary) {
  const server = value.serverAddr ? `${value.serverAddr}:${value.serverPort || '7000'}` : '未配置'
  const local = value.localPort || defaults.value.local_port
  const remote = value.remotePort || '0'
  return `${server} · 本地 ${local} → 远端 ${remote}`
}

function getInstanceDisplayName(value: FrpcInstanceStatus | null | undefined) {
  if (!value) return 'FRP 实例'
  const displayName = value.name.trim()
  if (displayName) return displayName
  if (value.summary.serverAddr) return `${value.summary.serverAddr}:${value.summary.serverPort || '7000'}`
  return value.isPrimary ? '主 FRP' : 'FRP 实例'
}

function backToList() {
  router.push({ path: '/tunnel', query: { tab: 'frp' } })
}

async function restoreInitialScrollPosition() {
  await nextTick()
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
  if (shouldOpenLogs.value) {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      left: 0,
    })
    return
  }
  if (shouldOpenConfig.value && configSectionRef.value) {
    configSectionRef.value.scrollIntoView({ block: 'start' })
    return
  }
  window.scrollTo({ top: 0, left: 0 })
}

async function loadDefaults() {
  const overview = await FrpcAPI.getInstances()
  defaults.value = overview.defaults
  if (!isCreateMode.value) {
    const next = overview.items.find((item) => item.id === instanceId.value)
    if (next) instance.value = next
  }
}

async function loadPage() {
  isLoading.value = true
  try {
    await loadDefaults()
    if (isCreateMode.value) {
      content.value = await FrpcAPI.createDraft()
      name.value = ''
      logs.value = []
      editorRef.value?.resetFromRaw(content.value)
      await restoreInitialScrollPosition()
      return
    }

    const detail = await FrpcAPI.getInstance(instanceId.value)
    instance.value = detail.item
    content.value = detail.content
    name.value = detail.item.name
    logs.value = detail.logs
    cursor.value = undefined
    editorRef.value?.resetFromRaw(detail.content)
    startPolling()
    await restoreInitialScrollPosition()
  } catch (error) {
    toast.error('加载 FRP 实例失败', { description: extractErrorMessage(error, '加载 FRP 实例失败') })
  } finally {
    isLoading.value = false
  }
}

async function saveInstance() {
  if (isSaving.value) return
  isSaving.value = true
  try {
    const nextContent = editorRef.value?.getContent() ?? content.value
    if (isCreateMode.value) {
      const created = await FrpcAPI.createInstance({
        name: name.value.trim(),
        content: nextContent,
      })
      toast.success('FRP 实例已创建')
      await router.replace({ path: `/tunnel/frp/instances/${encodeURIComponent(created.id)}` })
      await loadPage()
      return
    }

    if (!instance.value) return
    const wasRunning = instance.value.running
    const updated = await FrpcAPI.updateInstance(instance.value.id, {
      name: name.value.trim(),
      content: nextContent,
    })
    instance.value = updated
    content.value = nextContent
    if (wasRunning) {
      await FrpcAPI.restartInstance(updated.id)
      toast.success('实例已保存并重启')
      await loadPage()
      return
    }
    toast.success('实例已保存')
  } catch (error) {
    toast.error('保存实例失败', { description: extractErrorMessage(error, '保存实例失败') })
  } finally {
    isSaving.value = false
  }
}

async function startInstance() {
  if (!instance.value || isStarting.value) return
  isStarting.value = true
  try {
    await FrpcAPI.startInstance(instance.value.id)
    await ConfigAPI.updateDefaultTunnel('frp')
    if (configStore.config) {
      configStore.config.default_tunnel = 'frp'
    }
    toast.success('启动成功')
    await loadPage()
  } catch (error) {
    toast.error('启动失败', { description: extractErrorMessage(error, '启动失败') })
  } finally {
    isStarting.value = false
  }
}

async function stopInstance() {
  if (!instance.value || isStopping.value) return
  isStopping.value = true
  try {
    await FrpcAPI.stopInstance(instance.value.id)
    toast.success('停止成功')
    await loadPage()
  } catch (error) {
    toast.error('停止失败', { description: extractErrorMessage(error, '停止失败') })
  } finally {
    isStopping.value = false
  }
}

async function clearLogs() {
  if (!instance.value || isClearingLogs.value) return
  isClearingLogs.value = true
  try {
    await FrpcAPI.clearInstanceLogs(instance.value.id)
    logs.value = []
    cursor.value = undefined
    toast.success('日志已清空')
  } catch (error) {
    toast.error('清空日志失败', { description: extractErrorMessage(error, '清空日志失败') })
  } finally {
    isClearingLogs.value = false
  }
}

async function pollLogs() {
  if (isCreateMode.value || !instance.value) return
  try {
    const payload = await FrpcAPI.pollInstance(instance.value.id, cursor.value)
    cursor.value = payload.cursor
    logs.value = mergePollingLogWindow(logs.value, payload.logs, {
      reset: payload.reset,
      max: DEFAULT_LOG_WINDOW_SIZE,
    })
    instance.value = payload.status
  } catch {
    stopPolling()
  }
}

function startPolling() {
  stopPolling()
  cursor.value = undefined
  void pollLogs()
  pollTimer = window.setInterval(() => {
    void pollLogs()
  }, 2000)
}

function stopPolling() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

onMounted(() => {
  void loadPage()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <div class="space-y-6">
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink href="#/tunnel?tab=frp">内网穿透</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink href="#/tunnel?tab=frp">FRP</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{{ isCreateMode ? '新增实例' : title }}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="space-y-2">
        <Button variant="ghost" size="sm" class="w-fit px-2" @click="backToList">
          <ArrowLeft class="mr-1.5 h-4 w-4" />
          返回 FRP 列表
        </Button>
        <div class="space-y-1">
          <h2 class="text-xl font-semibold">{{ title }}</h2>
          <p class="text-sm text-muted-foreground">{{ formatSummary(summary) }}</p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button
          v-if="!isCreateMode && instance && !instance.running"
          variant="outline"
          :disabled="isStarting"
          @click="startInstance"
        >
          <Play class="mr-1.5 h-4 w-4" />
          {{ isStarting ? '启动中...' : '启动' }}
        </Button>
        <Button
          v-if="!isCreateMode && instance?.running"
          variant="destructive"
          :disabled="isStopping"
          @click="stopInstance"
        >
          <Square class="mr-1.5 h-4 w-4" />
          {{ isStopping ? '停止中...' : '停止' }}
        </Button>
        <Button :disabled="isSaving || isLoading" @click="saveInstance">
          <Save class="mr-1.5 h-4 w-4" />
          {{ isSaving ? '保存中...' : '保存' }}
        </Button>
      </div>
    </div>

    <Card v-if="!isCreateMode && instance">
      <CardHeader>
        <CardTitle class="text-base">运行信息</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid gap-3 text-sm sm:grid-cols-3">
          <div class="rounded-lg border px-4 py-3">
            <p class="text-xs text-muted-foreground">状态</p>
            <div class="mt-1 flex items-center gap-2">
              <LiveStatusBadge :active="instance.running" />
              <span :class="instance.running ? 'text-green-600' : 'text-muted-foreground'">
                {{ instance.running ? '运行中' : '未运行' }}
              </span>
            </div>
          </div>
          <div class="rounded-lg border px-4 py-3">
            <p class="text-xs text-muted-foreground">PID</p>
            <p class="mt-1 font-mono">{{ instance.pid ?? '-' }}</p>
          </div>
          <div class="rounded-lg border px-4 py-3">
            <p class="text-xs text-muted-foreground">日志接管</p>
            <p class="mt-1">{{ instance.attached ? '当前进程' : '历史缓冲' }}</p>
          </div>
          <div class="rounded-lg border px-4 py-3">
            <p class="text-xs text-muted-foreground">最近启动</p>
            <p class="mt-1">
              <HumanFriendlyTime :value="instance.startedAt" />
            </p>
          </div>
          <div class="rounded-lg border px-4 py-3">
            <p class="text-xs text-muted-foreground">最近停止</p>
            <p class="mt-1">
              <HumanFriendlyTime :value="instance.stoppedAt" />
            </p>
          </div>
          <div class="rounded-lg border px-4 py-3">
            <p class="text-xs text-muted-foreground">创建时间</p>
            <p class="mt-1">
              <HumanFriendlyTime :value="instance.createdAt" />
            </p>
          </div>
        </div>

        <div class="grid gap-3 text-sm md:grid-cols-2">
          <div class="rounded-lg border px-4 py-3">
            <p class="text-xs text-muted-foreground">配置路径</p>
            <p class="mt-1 break-all font-mono text-xs">{{ instance.configPath }}</p>
          </div>
          <div class="rounded-lg border px-4 py-3">
            <p class="text-xs text-muted-foreground">工作目录</p>
            <p class="mt-1 break-all font-mono text-xs">{{ instance.workDir }}</p>
          </div>
        </div>

        <p v-if="instance.lastMessage" class="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          {{ instance.lastMessage }}
        </p>
      </CardContent>
    </Card>

    <div ref="configSectionRef">
      <Card>
        <CardHeader>
          <CardTitle class="text-base">实例配置</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="grid gap-2 sm:grid-cols-[160px_1fr] sm:items-start">
            <div class="space-y-1 mt-1.5">
              <Label for="frp-instance-name">名称</Label>
              <p class="hidden text-xs text-muted-foreground sm:block">可选，用于区分不同入口。</p>
            </div>
            <Input id="frp-instance-name" v-model="name" placeholder="例如：备用入口" />
          </div>

          <FrpcInstanceEditor
            ref="editorRef"
            v-model="content"
            :defaults="defaults"
            :id-prefix="isCreateMode ? 'frp-instance-create' : `frp-instance-${instanceId}`"
          />
        </CardContent>
      </Card>
    </div>

    <div v-if="!isCreateMode">
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between gap-3">
            <CardTitle class="text-base">实例日志</CardTitle>
            <Button
              variant="outline"
              size="sm"
              :disabled="isClearingLogs || logs.length === 0"
              @click="clearLogs"
            >
              <Trash2 class="mr-1.5 h-3.5 w-3.5" />
              清空
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <LogViewer :logs="logs" reversed :show-header="false" />
        </CardContent>
      </Card>
    </div>
  </div>
</template>
