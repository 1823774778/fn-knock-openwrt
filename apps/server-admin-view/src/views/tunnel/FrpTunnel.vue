<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ConfigAPI,
  FrpcAPI,
  SystemAPI,
  type FrpcInstanceStatus,
  type FrpcInstanceSummary,
  type FrpcInstancesOverview,
} from '../../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Info, Pencil, Play, Plus, ScrollText, Square, Trash2 } from 'lucide-vue-next'
import { toast } from '@admin-shared/utils/toast'
import LogViewer from '@admin-shared/components/LogViewer.vue'
import ConfigCollapsibleCard from '@admin-shared/components/ConfigCollapsibleCard.vue'
import ConfirmDangerPopover from '@admin-shared/components/common/ConfirmDangerPopover.vue'
import HumanFriendlyTime from '@admin-shared/components/common/HumanFriendlyTime.vue'
import { extractErrorMessage, useAsyncAction } from '@admin-shared/composables/useAsyncAction'
import { DEFAULT_LOG_WINDOW_SIZE, mergePollingLogWindow } from '@admin-shared/utils/log-window'
import { useTargetPolling } from '../../composables/useTargetPolling'
import { useConfigStore } from '../../store/config'
import DocsLinkButton from '../../components/DocsLinkButton.vue'
import LiveStatusBadge from '../../components/LiveStatusBadge.vue'
import { extractVisualFieldsFromToml } from '../../lib/frpc-config-editor'
import { docsUrls } from '../../lib/docs'
import FrpcInstanceEditor from './frp/FrpcInstanceEditor.vue'

withDefaults(defineProps<{
  showDocsButton?: boolean
}>(), {
  showDocsButton: false,
})

type FrpcEditorExpose = {
  getContent: () => string
  resetFromRaw: (raw: string) => void
}

const router = useRouter()
const configStore = useConfigStore()

const overview = ref<FrpcInstancesOverview | null>(null)
const primaryConfig = ref('')
const primaryLogs = ref<string[]>([])
const showInitDialog = ref(false)
const configLoaded = ref(false)
const primaryEditorRef = ref<FrpcEditorExpose | null>(null)
const startingInstanceId = ref<string | null>(null)
const stoppingInstanceId = ref<string | null>(null)
const deletingInstanceId = ref<string | null>(null)

const defaults = computed(() => overview.value?.defaults ?? { local_port: '7999' })
const primaryInstance = computed(() =>
  overview.value?.items.find((item) => item.id === overview.value?.primaryInstanceId) ?? null,
)
const extraInstances = computed(() =>
  overview.value?.items.filter((item) => !item.isPrimary) ?? [],
)
const isInit = computed(() => overview.value?.initialized ?? false)
const running = computed(() => primaryInstance.value?.running ?? false)
const pid = computed(() => primaryInstance.value?.pid ?? null)
const canStart = computed(() => isInit.value && !running.value)
const canStop = computed(() => running.value)
const primarySummary = computed(() =>
  primaryInstance.value?.summary ?? summarizeContent(primaryConfig.value),
)

const { isPending: isSaving, run: runSaveConfig } = useAsyncAction({
  onError: (error) => {
    toast.error('保存失败', { description: extractErrorMessage(error, '保存失败') })
  },
})
const { isPending: isStarting, run: runStartFrpc } = useAsyncAction()
const { isPending: isStopping, run: runStopFrpc } = useAsyncAction()
const { isPending: isClearingLogs, run: runClearLogs } = useAsyncAction({
  onError: (error) => {
    toast.error('清空日志失败', { description: extractErrorMessage(error, '清空日志失败') })
  },
})
const { run: runLoadStatus } = useAsyncAction({
  onError: (error) => {
    toast.error('加载状态失败', { description: extractErrorMessage(error, '加载状态失败') })
  },
})
const { run: runLoadConfig } = useAsyncAction({
  onError: (error) => {
    toast.error('加载配置失败', { description: extractErrorMessage(error, '加载配置失败') })
  },
})

const startErrorTrace = ref<{
  pid: number
  markerSeen: boolean
  expireAt: number
} | null>(null)
const START_ERROR_WATCH_MS = 30_000
const CONNECTION_REFUSED_REGEX = /\bconnection refused\b/i

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

function formatSummary(summary: FrpcInstanceSummary) {
  const server = summary.serverAddr ? `${summary.serverAddr}:${summary.serverPort || '7000'}` : '未配置'
  const local = summary.localPort || defaults.value.local_port
  const remote = summary.remotePort || '0'
  return `${server} · 本地 ${local} → 远端 ${remote}`
}

function getInstanceDisplayName(instance: FrpcInstanceStatus | null | undefined) {
  if (!instance) return 'FRP 实例'
  const name = instance.name.trim()
  if (name) return name
  if (instance.summary.serverAddr) return `${instance.summary.serverAddr}:${instance.summary.serverPort || '7000'}`
  return instance.isPrimary ? '主 FRP' : 'FRP 实例'
}

function updateOverviewItem(item: FrpcInstanceStatus) {
  if (!overview.value) return
  overview.value = {
    ...overview.value,
    items: overview.value.items.map((current) => (current.id === item.id ? item : current)),
    runningCount: overview.value.items.reduce(
      (count, current) => count + (current.id === item.id ? Number(item.running) : Number(current.running)),
      0,
    ),
  }
}

function gotoInstanceCreate() {
  router.push({ path: '/tunnel/frp/instances/new' })
}

function gotoInstanceDetail(instance: FrpcInstanceStatus, section?: 'config' | 'logs') {
  router.push({
    path: `/tunnel/frp/instances/${encodeURIComponent(instance.id)}`,
    query: section ? { section } : undefined,
  })
}

async function loadStatus() {
  await runLoadStatus(async () => {
    const data = await FrpcAPI.getInstances()
    overview.value = data
    if (!data.initialized) {
      const sys = await SystemAPI.getFrpStatus()
      if (!sys?.data?.downloaded) {
        showInitDialog.value = true
      }
    }
  })
}

async function loadConfig() {
  await runLoadConfig(
    async () => {
      const raw = await FrpcAPI.getConfig()
      primaryConfig.value = raw
      primaryEditorRef.value?.resetFromRaw(raw)
    },
    {
      onFinally: () => {
        configLoaded.value = true
      },
    },
  )
}

async function saveConfig() {
  await runSaveConfig(async () => {
    const content = primaryEditorRef.value?.getContent() ?? primaryConfig.value
    const shouldRestart = running.value
    await FrpcAPI.saveConfig(content)
    primaryConfig.value = content
    if (shouldRestart) {
      await FrpcAPI.stop()
      const res = await FrpcAPI.start()
      startErrorTrace.value = {
        pid: res.pid,
        markerSeen: false,
        expireAt: Date.now() + START_ERROR_WATCH_MS,
      }
      toast.success('重启成功')
    } else {
      toast.success('保存成功')
    }
    await loadStatus()
  })
}

async function startFrpc(options?: { silent?: boolean }) {
  await runStartFrpc(
    () => FrpcAPI.start(),
    {
      onSuccess: async (res) => {
        startErrorTrace.value = {
          pid: res.pid,
          markerSeen: false,
          expireAt: Date.now() + START_ERROR_WATCH_MS,
        }
        await ConfigAPI.updateDefaultTunnel('frp')
        if (configStore.config) {
          configStore.config.default_tunnel = 'frp'
        }
        await loadStatus()
        if (!options?.silent) toast.success('启动成功')
      },
      onError: (error) => {
        if (options?.silent) return
        const message = extractErrorMessage(error, '启动失败')
        if (CONNECTION_REFUSED_REGEX.test(message)) {
          toast.error('启动失败', { description: '无法连接到 FRP 服务端（connection refused），请检查服务端地址、端口和服务状态。' })
          return
        }
        toast.error('启动失败', { description: message })
      },
    },
  )
}

async function stopFrpc(options?: { silent?: boolean }) {
  await runStopFrpc(
    () => FrpcAPI.stop(),
    {
      onSuccess: async () => {
        await loadStatus()
        if (!options?.silent) toast.success('停止成功')
      },
      onError: (error) => {
        if (options?.silent) return
        toast.error('停止失败', { description: extractErrorMessage(error, '停止失败') })
      },
    },
  )
}

async function onClearLogsClick() {
  await runClearLogs(
    () => FrpcAPI.clearLogs(),
    {
      onSuccess: () => {
        primaryLogs.value = []
        frpcPolling.resetCursor()
        void frpcPolling.refresh()
        toast.success('日志已清空')
      },
    },
  )
}

async function startInstance(instance: FrpcInstanceStatus) {
  if (startingInstanceId.value) return
  startingInstanceId.value = instance.id
  try {
    await FrpcAPI.startInstance(instance.id)
    await ConfigAPI.updateDefaultTunnel('frp')
    if (configStore.config) {
      configStore.config.default_tunnel = 'frp'
    }
    toast.success('启动成功')
    await loadStatus()
  } catch (error) {
    toast.error('启动失败', { description: extractErrorMessage(error, '启动失败') })
  } finally {
    startingInstanceId.value = null
  }
}

async function stopInstance(instance: FrpcInstanceStatus) {
  if (stoppingInstanceId.value) return
  stoppingInstanceId.value = instance.id
  try {
    await FrpcAPI.stopInstance(instance.id)
    toast.success('停止成功')
    await loadStatus()
  } catch (error) {
    toast.error('停止失败', { description: extractErrorMessage(error, '停止失败') })
  } finally {
    stoppingInstanceId.value = null
  }
}

async function deleteInstance(instance: FrpcInstanceStatus) {
  if (deletingInstanceId.value) return
  deletingInstanceId.value = instance.id
  try {
    await FrpcAPI.deleteInstance(instance.id)
    toast.success('FRP 实例已删除')
    await loadStatus()
  } catch (error) {
    toast.error('删除失败', { description: extractErrorMessage(error, '删除失败') })
  } finally {
    deletingInstanceId.value = null
  }
}

function gotoFrpResources() {
  showInitDialog.value = false
  router.push({ path: '/system', query: { tab: 'frp' } })
}

function handleStartFailureLogs(lines: string[]) {
  const trace = startErrorTrace.value
  if (!trace) return
  if (Date.now() > trace.expireAt) {
    startErrorTrace.value = null
    return
  }

  for (const line of lines) {
    const text = line.trim()
    if (!text) continue
    if (!trace.markerSeen && text.includes(`frpc started pid=${trace.pid}`)) {
      trace.markerSeen = true
      continue
    }
    if (!trace.markerSeen) continue
    if (!CONNECTION_REFUSED_REGEX.test(text)) continue
    toast.error('启动失败', { description: '无法连接到 FRP 服务端（connection refused），请检查服务端地址、端口和服务状态。' })
    startErrorTrace.value = null
    return
  }
}

const frpcPolling = useTargetPolling({
  target: 'frpc',
  intervalMs: 2000,
  onData: (payload) => {
    primaryLogs.value = mergePollingLogWindow(primaryLogs.value, payload.logs, {
      reset: payload.reset,
      max: DEFAULT_LOG_WINDOW_SIZE,
    })

    if (payload.status.instances) {
      overview.value = payload.status.instances
    } else {
      updateOverviewItem(payload.status)
    }
    handleStartFailureLogs(payload.logs)
  },
})

onMounted(async () => {
  await loadStatus()
  await loadConfig()
  frpcPolling.start()
})
onUnmounted(() => {
  frpcPolling.stop()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="space-y-1">
        <h2 class="text-xl font-semibold">FRP穿透</h2>
        <p class="text-sm text-muted-foreground">
          运行中 {{ overview?.runningCount ?? 0 }} / 共 {{ overview?.total ?? 0 }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <DocsLinkButton
          v-if="showDocsButton"
          :href="docsUrls.guides.tunnel"
          size="default"
          class="shrink-0"
        />
        <Button v-if="!running" :disabled="!canStart || isStarting" @click="startFrpc">
          <Play class="mr-1.5 h-4 w-4" />
          启动
        </Button>
        <Button v-else variant="destructive" :disabled="!canStop || isStopping" @click="stopFrpc">
          <Square class="mr-1.5 h-4 w-4" />
          停止
        </Button>
      </div>
    </div>

    <ConfigCollapsibleCard
      title="主 FRP 配置"
      :configured="Boolean(primarySummary.serverAddr)"
      :ready="configLoaded"
      summary-class="text-xs text-muted-foreground"
      expanded-content-class="p-0 sm:p-0"
    >
      <template #summary>
        {{ formatSummary(primarySummary) }}
      </template>

      <template #default>
        <FrpcInstanceEditor
          ref="primaryEditorRef"
          v-model="primaryConfig"
          :defaults="defaults"
          id-prefix="frp-primary"
        />
      </template>

      <template #actions="{ collapse }">
        <div class="p-4 sm:px-6 sm:py-4 bg-muted/30 border-t flex items-center justify-end gap-3 rounded-b-lg">
          <Button variant="outline" @click="collapse">折叠</Button>
          <Button :disabled="isSaving" @click="saveConfig" class="min-w-[100px] shadow-sm">保存</Button>
        </div>
      </template>
    </ConfigCollapsibleCard>

    <Card>
      <CardHeader>
        <div class="flex items-center justify-between gap-3">
          <CardTitle class="text-base">主实例连接信息</CardTitle>
          <Button variant="outline" size="sm" :disabled="isClearingLogs || primaryLogs.length === 0" @click="onClearLogsClick">
            <Trash2 class="h-3.5 w-3.5 mr-1" />
            清空
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <div class="text-xs text-muted-foreground">状态</div>
            <div class="mt-1 flex items-center gap-2">
              <LiveStatusBadge :active="running" />
              <span :class="running ? 'text-green-600' : 'text-muted-foreground'">
                {{ running ? '运行中' : '未运行' }}
              </span>
            </div>
          </div>
          <div>
            <div class="text-xs text-muted-foreground">PID</div>
            <div class="mt-1 font-mono">{{ pid ?? '-' }}</div>
          </div>
          <div>
            <div class="text-xs text-muted-foreground">日志接管</div>
            <div class="mt-1">{{ primaryInstance?.attached ? '当前进程' : '历史缓冲' }}</div>
          </div>
        </div>
        <LogViewer :logs="primaryLogs" reversed :show-header="false" />
      </CardContent>
    </Card>

    <Card class="gap-2">
      <CardHeader>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="space-y-1">
            <CardTitle class="text-base">更多 FRP</CardTitle>
            <p class="text-sm text-muted-foreground">
              额外加入的 FRP 客户端实例，不影响主 FRP 配置。
            </p>
          </div>
          <Button size="sm" @click="gotoInstanceCreate">
            <Plus class="mr-1.5 h-4 w-4" />
            新增 FRP
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <div
          v-if="extraInstances.length === 0"
          class="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground"
        >
          暂无更多 FRP。新增后可让多个 frpc 进程独立运行。
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="instance in extraInstances"
            :key="instance.id"
            class="rounded-lg border bg-card px-4 py-4"
          >
            <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div class="min-w-0 space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-sm font-medium">{{ getInstanceDisplayName(instance) }}</p>
                  <span class="inline-flex items-center gap-1.5 text-xs" :class="instance.running ? 'text-green-600' : 'text-muted-foreground'">
                    <LiveStatusBadge :active="instance.running" size="xs" />
                    {{ instance.running ? '运行中' : '未运行' }}
                  </span>
                </div>
                <p class="text-sm text-muted-foreground break-all">
                  {{ formatSummary(instance.summary) }}
                </p>
                <p v-if="instance.lastMessage" class="text-xs text-muted-foreground">
                  {{ instance.lastMessage }}
                </p>
              </div>

              <div class="grid gap-3 sm:grid-cols-3 lg:min-w-[360px]">
                <div class="rounded-lg px-3 py-2">
                  <p class="text-[10px] uppercase tracking-wider text-muted-foreground">PID</p>
                  <p class="mt-1 font-mono text-sm">{{ instance.pid ?? '-' }}</p>
                </div>
                <div class="rounded-lg px-3 py-2">
                  <p class="text-[10px] uppercase tracking-wider text-muted-foreground">最近启动</p>
                  <p class="mt-1 text-sm">
                    <HumanFriendlyTime :value="instance.startedAt" />
                  </p>
                </div>
                <div class="rounded-lg px-3 py-2">
                  <p class="text-[10px] uppercase tracking-wider text-muted-foreground">日志</p>
                  <p class="mt-1 text-sm">{{ instance.attached ? '实时接管' : '历史缓冲' }}</p>
                </div>
              </div>
            </div>

            <div class="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" @click="gotoInstanceDetail(instance, 'config')">
                <Pencil class="mr-1.5 h-3.5 w-3.5" />
                编辑
              </Button>
              <Button
                v-if="!instance.running"
                variant="outline"
                size="sm"
                :disabled="startingInstanceId === instance.id"
                @click="startInstance(instance)"
              >
                <Play class="mr-1.5 h-3.5 w-3.5" />
                {{ startingInstanceId === instance.id ? '启动中...' : '启动' }}
              </Button>
              <Button
                v-else
                variant="outline"
                size="sm"
                :disabled="stoppingInstanceId === instance.id"
                @click="stopInstance(instance)"
              >
                <Square class="mr-1.5 h-3.5 w-3.5" />
                {{ stoppingInstanceId === instance.id ? '停止中...' : '停止' }}
              </Button>
              <Button variant="outline" size="sm" @click="gotoInstanceDetail(instance, 'logs')">
                <ScrollText class="mr-1.5 h-3.5 w-3.5" />
                日志
              </Button>
              <Button variant="outline" size="sm" @click="gotoInstanceDetail(instance)">
                <Info class="mr-1.5 h-3.5 w-3.5" />
                查看更多
              </Button>
              <ConfirmDangerPopover
                title="确认删除 FRP 实例？"
                :description="`删除会先停止 ${getInstanceDisplayName(instance)}，并移除该实例配置与日志缓冲。`"
                :loading="deletingInstanceId === instance.id"
                :disabled="deletingInstanceId === instance.id"
                :on-confirm="() => deleteInstance(instance)"
                content-class="w-72 text-left"
              >
                <template #trigger>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="deletingInstanceId === instance.id"
                    class="text-destructive hover:text-destructive"
                  >
                    <Trash2 class="mr-1.5 h-3.5 w-3.5" />
                    {{ deletingInstanceId === instance.id ? '删除中...' : '删除' }}
                  </Button>
                </template>
              </ConfirmDangerPopover>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="showInitDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>FRP 未初始化</DialogTitle>
        </DialogHeader>
        <p class="text-sm text-muted-foreground">请先在 系统设置 → FRP资源 中完成初始化。</p>
        <DialogFooter>
          <Button @click="gotoFrpResources">前往初始化</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
