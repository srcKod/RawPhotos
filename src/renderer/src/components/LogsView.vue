<script setup>
import { useI18n } from 'vue-i18n'
import { ref, onMounted, onUnmounted } from 'vue'
import { toast } from '../composables/useToast'
import Icon from './Icon.vue'

const { t } = useI18n()
const logs = ref([])
const loading = ref(false)
const expanded = ref(null)
let off = null

const KIND = {
  image: 'logs.type_image',
  video: 'logs.type_video',
  optimize: 'logs.type_optimize',
  chat: 'logs.type_chat',
  test: 'logs.type_test'
}

function fmtTime(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

async function refresh() {
  loading.value = true
  try {
    logs.value = await window.api.getLogs()
  } catch (err) {
    toast.error(t('logs.read_failed') + ': ' + err.message)
  } finally {
    loading.value = false
  }
}

async function clear() {
  try {
    await window.api.clearLogs()
    logs.value = []
    expanded.value = null
    toast.success(t('logs.cleared'))
  } catch (err) {
    toast.error(t('logs.clear_failed') + ': ' + err.message)
  }
}

async function openFile() {
  try {
    const f = await window.api.openLogFile()
    toast.info(t('logs.opened') + ' ' + f)
  } catch (err) {
    toast.error(t('logs.open_failed') + ': ' + err.message)
  }
}

function toggle(id) {
  expanded.value = expanded.value === id ? null : id
}

async function copyDetail(e) {
  const lines = [
    `${t('logs.time')}: ${new Date(e.time).toLocaleString()}`,
    `${t('logs.type')}: ${t(KIND[e.kind] || e.kind)} · ${e.ok ? t('logs.success') : t('logs.failed')}`,
    `${t('settings.interface_config')}: ${e.provider || '-'} · ${t('settings.model')} ${e.model || '-'}`,
    `URL: ${e.url || '-'}`,
    `${t('logs.http')}: ${e.status ?? '-'} · ${t('logs.duration')}: ${e.durationMs ?? '-'}ms`,
    `${t('logs.info')}: ${e.message || '-'}`,
    e.detail ? `${t('logs.raw_head')}:\n${e.detail}` : ''
  ]
  try {
    await navigator.clipboard.writeText(lines.filter(Boolean).join('\n'))
    toast.success(t('logs.copy_success'))
  } catch {
    toast.error(t('toast.copy_failed'))
  }
}

onMounted(() => {
  refresh()
  off = window.api.onLog((entry) => {
    logs.value.unshift(entry)
    if (logs.value.length > 300) logs.value.length = 300
  })
})
onUnmounted(() => off && off())
</script>

<template>
  <div class="view">
    <header class="view-head">
      <div class="head-title">
        <h1>{{ t('logs.title') }}</h1>
        <p class="sub">{{ t('logs.sub') }} · {{ logs.length }} {{ t('logs.count') }}</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-sm" :disabled="loading" @click="refresh">
          <span v-if="loading" class="spin"></span>
          <Icon v-else name="refresh" :size="15" />
          <span>{{ t('logs.refresh') }}</span>
        </button>
        <button class="btn btn-sm" @click="openFile">
          <Icon name="folder-open" :size="15" /><span>{{ t('logs.file') }}</span>
        </button>
        <button class="btn btn-sm" @click="clear">
          <Icon name="trash" :size="15" /><span>{{ t('logs.clear') }}</span>
        </button>
      </div>
    </header>

    <div class="scroll">
      <div v-if="logs.length" class="log-list">
        <div v-for="e in logs" :key="e.id" class="log-item" :class="{ err: !e.ok }">
          <button class="log-row" @click="toggle(e.id)">
            <span class="dot" :class="e.ok ? 'ok' : 'bad'"></span>
            <span class="time">{{ fmtTime(e.time) }}</span>
            <span class="kind" :class="e.kind">{{ t(KIND[e.kind] || e.kind) }}</span>
            <span class="status" v-if="e.status">{{ e.status }}</span>
            <span class="msg">{{ e.message }}</span>
            <span class="model">{{ e.model || '' }}</span>
            <Icon name="chevron" :size="14" class="chev" :class="{ open: expanded === e.id }" />
          </button>

          <div v-if="expanded === e.id" class="log-detail">
            <div class="kv"><span>{{ t('settings.interface_config') }}</span><b>{{ e.provider || '-' }}</b></div>
            <div class="kv"><span>{{ t('settings.model') }}</span><b>{{ e.model || '-' }}</b></div>
            <div class="kv"><span>{{ t('logs.url') }}</span><b class="mono">{{ e.url || '-' }}</b></div>
            <div class="kv"><span>{{ t('logs.http') }}</span><b>{{ e.status ?? '-' }} · {{ e.durationMs ?? '-' }}ms</b></div>
            <div class="kv"><span>{{ t('logs.info') }}</span><b>{{ e.message }}</b></div>
            <div v-if="e.detail" class="raw">
              <div class="raw-head">{{ t('logs.raw_head') }}</div>
              <pre>{{ e.detail }}</pre>
            </div>
            <button class="btn btn-sm btn-ghost copy-btn" @click="copyDetail(e)">
              <Icon name="copy" :size="14" /><span>{{ t("logs.copy_entry") }}</span>
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="!loading" class="empty">
        <div class="empty-art"><Icon name="logs" :size="32" /></div>
        <p class="empty-title">{{ t('logs.empty_title') }}</p>
        <p class="empty-sub">{{ t('logs.empty_sub') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.view-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22px 30px 18px;
  border-bottom: 1px solid var(--border);
}
.head-title h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
.sub {
  margin: 4px 0 0;
  color: var(--text-3);
  font-size: 12.5px;
}
.head-actions {
  display: flex;
  gap: 8px;
}
.scroll {
  flex: 1;
  overflow-y: auto;
  padding: 18px 30px 40px;
}
.log-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.log-item {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  overflow: hidden;
}
.log-item.err {
  border-color: rgba(240, 82, 106, 0.35);
}
.log-row {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 10px 13px;
  text-align: left;
}
.log-row:hover {
  background: var(--surface-2);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot.ok {
  background: var(--success);
}
.dot.bad {
  background: var(--danger);
}
.time {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.kind {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-2);
  flex-shrink: 0;
}
/* Mid-brightness purple/blue, readable in both light and dark themes (the old pale purple/blue was unreadable on white) */
.kind.image {
  color: #7c5cf0;
}
.kind.video {
  color: #4f83e0;
}
.kind.optimize,
.kind.chat {
  color: var(--accent);
}
.status {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.msg {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model {
  font-size: 11px;
  color: var(--text-3);
  flex-shrink: 0;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chev {
  color: var(--text-3);
  flex-shrink: 0;
  transform: rotate(90deg);
  transition: transform 0.16s ease;
}
.chev.open {
  transform: rotate(-90deg);
}
.log-detail {
  padding: 12px 14px 14px;
  border-top: 1px solid var(--border);
  background: var(--bg-1);
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.kv {
  display: flex;
  gap: 10px;
  font-size: 12.5px;
}
.kv > span {
  flex-shrink: 0;
  width: 48px;
  color: var(--text-3);
}
.kv > b {
  color: var(--text);
  font-weight: 550;
  word-break: break-all;
}
.mono {
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 12px;
}
.raw {
  margin-top: 4px;
}
.raw-head {
  font-size: 11.5px;
  color: var(--text-3);
  margin-bottom: 5px;
}
.raw pre {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-2);
  border: 1px solid var(--border);
  color: var(--text-2);
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}
.copy-btn {
  align-self: flex-start;
  margin-top: 4px;
}
.empty {
  margin-top: 64px;
  text-align: center;
  color: var(--text-3);
}
.empty-art {
  width: 72px;
  height: 72px;
  margin: 0 auto;
  border-radius: 20px;
  display: grid;
  place-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--accent);
}
.empty-title {
  font-size: 15px;
  color: var(--text-2);
  margin: 16px 0 4px;
  font-weight: 600;
}
.empty-sub {
  font-size: 12.5px;
  margin: 0;
}
</style>
