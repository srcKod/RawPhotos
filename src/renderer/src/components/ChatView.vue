<script setup>
import { useI18n } from 'vue-i18n'
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { marked } from 'marked'
import { store, persistSettings, activeProvider } from '../store'
import { toast } from '../composables/useToast'
import Icon from './Icon.vue'
import Dropdown from './Dropdown.vue'

marked.setOptions({ breaks: true, gfm: true })

function sanitizeHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}
function mdToHtml(text) {
  try {
    return sanitizeHtml(marked.parse(text || ''))
  } catch {
    return String(text || '')
  }
}
function onMsgClick(e) {
  const a = e.target.closest('a')
  if (a && a.getAttribute('href')) {
    e.preventDefault()
    window.api.openExternal(a.getAttribute('href'))
  }
}

const { t } = useI18n()
const messages = ref([]) // { id, role, text, images:[dataUrl], files:[{name}], error? }
const input = ref('')
const attachments = ref([])
const sending = ref(false)
const models = ref([])
const fileInput = ref(null)
const scroller = ref(null)

const currentId = ref(null)
const convList = ref([])
const showList = ref(true)

let seed = 0
const uid = () => `m${Date.now()}-${seed++}`

// Agentic chat: tool-call cards + permission prompts streamed from the main process
const agentPending = ref([]) // [{ callId, tool, display }]
const unsubs = [] // IPC listeners removed when the view unmounts

const CHAT_FILTER = /image|video|imagine|flux|sora|kling|dall|midjourney/i

const providers = computed(() => store.settings.providers || [])

// Agent workspace indicator: shows where agent file tools operate
const agentWorkspace = computed(() => (store.settings.agentWorkspace || '').trim())
const workspaceName = computed(() => {
  const p = agentWorkspace.value
  if (!p) return t('chat.ws_home')
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
})
async function openWorkspace() {
  if (!agentWorkspace.value) return
  await window.api.openPath(agentWorkspace.value)
}
const providerOptions = computed(() =>
  providers.value.map((p) => ({ value: p.id, label: p.name || t('settings.unnamed_interface') }))
)
// Chat picks its own provider/model (independent from the generate view's "current interface")
const chatProviderId = computed({
  get: () => store.settings.chatProviderId || store.settings.activeProviderId,
  set: async (id) => {
    await persistSettings({ chatProviderId: id })
    await loadModels()
    ensureChatModel()
  }
})
const provider = computed(
  () => providers.value.find((p) => p.id === chatProviderId.value) || activeProvider()
)
const configured = computed(() => Boolean(provider.value && provider.value.baseUrl))

// Chat-usable models: the fetched /models list with obvious image/video models filtered
// out (avoids wrong-tool answers), merged with every model ID the user set manually in
// Settings. Manual IDs are the user's responsibility — always offered as-is and
// deduplicated against the endpoint list (kept at the front for visibility).
const offeredChatModels = computed(() => {
  const p = provider.value
  const manual = [p?.optimizeModel, p?.imageModel, p?.videoModel].filter(Boolean)
  const list = models.value.filter((m) => !CHAT_FILTER.test(m))
  return [...new Set([...manual, ...list])]
})
const chatModel = computed({
  // Auto-select chain: explicit pick > provider optimize field > first chat-capable
  // fetched model (manual image/video IDs stay selectable in the list but are never
  // auto-selected for chat).
  get: () =>
    store.settings.chatModel ||
    provider.value?.optimizeModel ||
    models.value.find((m) => !CHAT_FILTER.test(m)) ||
    '',
  set: (v) => persistSettings({ chatModel: v })
})
const modelOptions = computed(() => {
  const cur = chatModel.value
  const list = [...offeredChatModels.value]
  if (cur && !list.includes(cur)) list.unshift(cur)
  return list.map((m) => ({ value: m, label: m }))
})

function ensureChatModel() {
  // Only drop an explicit pick the current provider cannot offer. Manual model IDs and
  // fetched models are never overwritten — a provider with a partial /models catalog
  // relies on manually set IDs staying usable (the user is responsible for them).
  const g = store.settings.chatModel
  if (!g) return
  const offered = offeredChatModels.value
  if (offered.length && !offered.includes(g)) persistSettings({ chatModel: '' })
}

function cleanError(msg) {
  return String(msg || t('chat.export_failed')).replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
}
function fmtTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const now = new Date()
  const p = (n) => String(n).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

async function loadModels() {
  const p = provider.value
  if (!p || !p.baseUrl) return
  try {
    const res = await window.api.listModels({ baseUrl: p.baseUrl, apiKey: p.apiKey })
    models.value = res.models || []
  } catch {
    models.value = []
  }
}

async function loadConvList() {
  try {
    convList.value = await window.api.chatsList()
  } catch {
    convList.value = []
  }
}

async function autoSave() {
  if (!messages.value.length) return
  if (!currentId.value) currentId.value = `c${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const firstUser = messages.value.find((m) => m.role === 'user')
  const title = ((firstUser && firstUser.text) || t('chat.new_conv_export')).slice(0, 24) || t('chat.new_conv_export')
  try {
    // Must strip the Vue reactive proxy before IPC: Proxy cannot be structured-cloned by Electron,
    // the direct pass would throw "object could not be cloned", get swallowed by the catch below,
    // and history would never persist (this was once a fatal bug)
    const plain = JSON.parse(JSON.stringify({ id: currentId.value, title, messages: messages.value }))
    await window.api.chatsSave(plain)
    loadConvList()
  } catch {
    // save failure must not interrupt the conversation
  }
}

async function openConv(id) {
  if (id === currentId.value) return
  if (messages.value.length) await autoSave() // save current chat before switching
  try {
    const c = await window.api.chatsGet(id)
    if (!c) return
    messages.value = c.messages || []
    currentId.value = id
    scrollDown()
  } catch {
    toast.error(t('chat.open_failed'))
  }
}

async function deleteConv(id) {
  try {
    await window.api.chatsDelete(id)
    if (id === currentId.value) newChat()
    loadConvList()
  } catch {
    toast.error(t('chat.delete_failed'))
  }
}

function resetChat() {
  messages.value = []
  input.value = ''
  attachments.value = []
  currentId.value = null
}

async function newChat() {
  if (messages.value.length) await autoSave() // save current chat into history before starting a new one
  resetChat()
  loadConvList()
}

async function clearCurrent() {
  if (!messages.value.length) return
  if (currentId.value) {
    try {
      await window.api.chatsDelete(currentId.value)
    } catch {
      // ignore
    }
    loadConvList()
  }
  resetChat()
  toast.success(t('chat.cleared'))
}

function stop() {
  // Main resolves any open permission waits as 'abort'; drop the cards here
  agentPending.value = []
  window.api.chatAbort()
}

// ---- Agent streaming ----
function toolSummary(m) {
  const d = m.display || {}
  return d.path || d.command || d.detail || ''
}
function onChatEvent(ev) {
  if (!ev) return
  if (ev.type === 'assistant') {
    messages.value.push({ id: uid(), role: 'assistant', text: ev.text, reasoning: ev.reasoning, intermediate: true, images: [], files: [] })
  } else if (ev.type === 'tool') {
    const existing = messages.value.find((x) => x.id === ev.callId)
    if (existing) {
      existing.state = ev.state
      existing.result = ev.result
      existing.display = ev.display
    } else {
      messages.value.push({ id: ev.callId, role: 'tool', tool: ev.tool, display: ev.display || {}, state: ev.state, result: ev.result })
    }
  }
  scrollDown()
}
function onPermission(req) {
  if (!req || !req.callId) return
  if (!agentPending.value.some((p) => p.callId === req.callId)) agentPending.value.push(req)
  scrollDown()
}
async function decidePermission(callId, decision) {
  agentPending.value = agentPending.value.filter((p) => p.callId !== callId)
  try {
    await window.api.agentConfirm(callId, decision)
  } catch {
    // window may be closing; main times the request out
  }
}

// Collapsed-by-default reasoning ("thinking") blocks, keyed by message id
const openThink = ref(new Set())
function toggleThink(id) {
  const s = openThink.value
  if (s.has(id)) s.delete(id)
  else s.add(id)
}
// Tool-call bubbles: collapsed by default, click the header to expand the raw result
const openTools = ref(new Set())
function toggleTool(id) {
  const s = openTools.value
  if (s.has(id)) s.delete(id)
  else s.add(id)
}
// Tool permission mode: 'ask' = confirm every call, 'auto' = silently allow
// read-only tools (list_dir/read_file), 'all' = never prompt. Persisted in
// settings and enforced by the main process on every tool call.
const toolModeOptions = computed(() => [
  { value: 'ask', label: t('chat.tool_mode_ask') },
  { value: 'auto', label: t('chat.tool_mode_auto') },
  { value: 'all', label: t('chat.tool_mode_all') }
])
const toolMode = computed({
  get: () => store.settings.chatToolMode || 'ask',
  set: (v) => {
    if (v === (store.settings.chatToolMode || 'ask')) return
    persistSettings({ chatToolMode: v })
  }
})

function buildMarkdown() {
  const lines = [
    `# ${t('chat.export_title')}`,
    '',
    t('chat.model') + ': ' + (chatModel.value || '-') + ' · ' + t('chat.export_time') + ': ' + new Date().toLocaleString(),
    ''
  ]
  for (const m of messages.value) {
    lines.push(m.role === 'user' ? t('chat.me') : t('chat.assistant'))
    if (m.files && m.files.length) lines.push(...m.files.map((f) => `📎 ${f.name}`))
    if (m.images && m.images.length) lines.push(`(${m.images.length} ${t('chat.images_unit')})`)
    if (m.reasoning) lines.push('> ' + t('chat.thinking') + ':\n> ' + String(m.reasoning).split('\n').join('\n> '))
    lines.push('', m.text || '', '')
  }
  return lines.join('\n')
}

async function exportMd() {
  if (!messages.value.length) {
    toast.error(t('chat.no_content'))
    return
  }
  const firstUser = messages.value.find((m) => m.role === 'user')
  const base = ((firstUser && firstUser.text) || t('chat.base_name_default')).slice(0, 16).replace(/[\\/:*?"<>|\n]/g, '_')
  try {
    const res = await window.api.saveTextFile({ content: buildMarkdown(), defaultName: `chat-${base}.md` })
    if (!res.canceled) toast.success(t('chat.export_success') + ' ' + res.path)
  } catch (err) {
    toast.error(`${t('chat.export_failed')}: ${cleanError(err.message)}`)
  }
}

function scrollDown() {
  nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  })
}

function onPickFile(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const r = new FileReader()
      r.onload = () => attachments.value.push({ kind: 'image', name: file.name, dataUrl: String(r.result || '') })
      r.readAsDataURL(file)
    } else if (file.size <= 256 * 1024 && /\.(txt|md|json|csv|log|js|ts|jsx|tsx|py|java|go|rs|c|cpp|h|html|css|xml|yml|yaml|ini|sh)$/i.test(file.name)) {
      const r = new FileReader()
      r.onload = () => attachments.value.push({ kind: 'text', name: file.name, text: String(r.result || '').slice(0, 20000) })
      r.readAsText(file)
    } else {
      toast.error(`${t('chat.unsupported_file')}: ${file.name}`)
    }
  }
}

function removeAttachment(i) {
  attachments.value.splice(i, 1)
}

function toApiMessage(m, overrideText) {
  const textPart = overrideText != null ? overrideText : m.text
  if (m.role === 'user' && m.images && m.images.length) {
    const content = []
    if (textPart) content.push({ type: 'text', text: textPart })
    for (const u of m.images) content.push({ type: 'image_url', image_url: { url: u } })
    return { role: 'user', content }
  }
  return { role: m.role, content: textPart ?? '' }
}

async function send() {
  if (!configured.value) {
    toast.error(t('settings.not_configured'))
    return
  }
  if (!chatModel.value) {
    toast.error(t('chat.no_model'))
    return
  }
  const text = input.value.trim()
  if (!text && !attachments.value.length) return

  const imgs = attachments.value.filter((a) => a.kind === 'image').map((a) => a.dataUrl)
  const textFiles = attachments.value.filter((a) => a.kind === 'text')
  const userMsg = {
    id: uid(),
    role: 'user',
    text,
    images: imgs,
    files: textFiles.map((a) => ({ name: a.name }))
  }
  let apiText = text
  for (const a of textFiles) apiText += `\n\n[${t('chat.file_tag')} ${a.name}]\n${a.text}`

  messages.value.push(userMsg)
  input.value = ''
  attachments.value = []
  scrollDown()

  // Only real conversation turns go back to the API: tool status rows are UI-only
  // (they have no tool_call_id and would serialize without content), and synthetic
  // error bubbles are not model output.
  const hist = messages.value
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.text && !m.error))
    .slice(-16)
  const apiMessages = hist.map((m) => toApiMessage(m, m === userMsg ? apiText : null))

  sending.value = true
  try {
    const res = await window.api.chatSend({
      providerId: chatProviderId.value,
      model: chatModel.value,
      messages: apiMessages,
      useTools: true
    })
    const aMsg = { id: uid(), role: 'assistant', text: res.content, images: [], files: [] }
    if (res.reasoning) aMsg.reasoning = res.reasoning
    messages.value.push(aMsg)
  } catch (err) {
    const msg = cleanError(err.message)
    if (!/stopped|cancel/i.test(msg)) {
      messages.value.push({ id: uid(), role: 'assistant', text: msg, images: [], files: [], error: true })
    }
  } finally {
    sending.value = false
    scrollDown()
    autoSave()
  }
}

async function copyMsg(m) {
  try {
    await navigator.clipboard.writeText(m.text || '')
    toast.success(t('chat.copied'))
  } catch {
    toast.error(t('toast.copy_failed'))
  }
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}

onMounted(async () => {
  await loadModels()
  ensureChatModel()
  await loadConvList()
  // Auto-resume the most recent conversation on entry (previously each entry was blank,
  // making users believe history was lost)
  if (!currentId.value && convList.value.length) openConv(convList.value[0].id)
  unsubs.push(window.api.onChatEvent(onChatEvent))
  unsubs.push(window.api.onAgentPermission(onPermission))
})

// Switching tabs destroys this component (v-if), so persist once more on the way out
onUnmounted(() => {
  unsubs.forEach((u) => {
    try { u() } catch { /* already gone */ }
  })
  autoSave()
})
</script>

<template>
  <div class="view">
    <header class="view-head">
      <div class="head-left">
        <button class="ghost-icon" :class="{ on: showList }" :title="t('chat.history')" @click="showList = !showList">
          <Icon name="logs" :size="17" />
        </button>
        <div class="head-title">
          <h1>{{ t('chat.title') }}</h1>
          <p class="sub">{{ t('chat.chat_with') }}</p>
        </div>
      </div>
      <div class="head-right">
        <button class="ghost-icon" :title="t('chat.export_markdown')" :disabled="!messages.length" @click="exportMd">
          <Icon name="download" :size="16" />
        </button>
        <button class="ghost-icon" :title="t('chat.clear_current')" @click="clearCurrent">
          <Icon name="eraser" :size="16" />
        </button>
      </div>
    </header>

    <div class="chat-body">
      <aside v-if="showList" class="conv-list">
        <button class="new-conv" @click="newChat">
          <Icon name="plus" :size="15" /><span>{{ t('chat.new_chat') }}</span>
        </button>
        <div class="conv-scroll">
          <button
            v-for="c in convList"
            :key="c.id"
            class="conv-item"
            :class="{ active: c.id === currentId }"
            @click="openConv(c.id)"
          >
            <Icon name="chat" :size="14" class="conv-ic" />
            <span class="conv-main">
              <span class="conv-title">{{ c.title || t('chat.new_chat') }}</span>
              <span class="conv-meta">{{ fmtTime(c.updatedAt) }} · {{ c.count }} {{ t('chat.entries') }}</span>
            </span>
            <span class="conv-del" :title="t('chat.delete')" @click.stop="deleteConv(c.id)">
              <Icon name="trash" :size="13" />
            </span>
          </button>
          <div v-if="!convList.length" class="conv-empty">
            <Icon name="chat" :size="20" />
            <span>{{ t('chat.empty_title') }}</span>
            <small>{{ t('chat.empty_sub') }}</small>
          </div>
        </div>
      </aside>

      <div class="chat-main">
        <div ref="scroller" class="messages">
          <div v-if="!messages.length" class="empty">
            <div class="empty-art"><Icon name="chat" :size="34" /></div>
            <p class="empty-title">{{ t('chat.start_title') }}</p>
            <p class="empty-sub">
              {{ t('chat.current_model') }}:<b>{{ chatModel || t('chat.no_model_selected') }}</b><br />
              {{ t('chat.upload_tip') }}
            </p>
          </div>

          <div v-for="m in messages" :key="m.id" class="msg" :class="m.role">
            <div class="avatar" :class="m.role">
              <Icon :name="m.role === 'user' ? 'group' : (m.role === 'tool' ? 'logs' : 'chat')" :size="15" />
            </div>
            <div v-if="m.role === 'tool'" class="bubble tool-bubble" :class="[m.state, { open: openTools.has(m.id) }]">
              <button class="tool-head" type="button" @click="toggleTool(m.id)">
                <span class="tool-chev" :class="{ open: openTools.has(m.id) }">▸</span>
                <span class="tool-kind">{{ m.tool || 'tool' }}</span>
                <span class="tool-detail">{{ toolSummary(m) }}</span>
                <span class="tool-state">{{ m.state === 'ok' ? '✓' : m.state === 'error' ? '✗' : m.state === 'denied' ? '⊘' : '…' }}</span>
              </button>
              <div v-show="openTools.has(m.id)" v-if="m.result && toolSummary(m) !== m.result" class="tool-result" dir="auto">{{ m.result }}</div>
            </div>
            <div v-else class="bubble" :class="{ error: m.error }">
              <div v-if="m.reasoning" class="think">
                <button class="think-head" type="button" @click="toggleThink(m.id)">
                  <span class="think-chev" :class="{ open: openThink.has(m.id) }">▸</span>
                  <span>{{ t('chat.thinking') }}</span>
                </button>
                <div v-show="openThink.has(m.id)" class="think-body" dir="auto">{{ m.reasoning }}</div>
              </div>
              <div v-if="m.images && m.images.length" class="msg-imgs">
                <img v-for="(im, i) in m.images" :key="i" :src="im" :alt="t('gallery.images')" />
              </div>
              <div v-if="m.files && m.files.length" class="msg-files">
                <span v-for="(f, i) in m.files" :key="i" class="file-chip">
                  <Icon name="logs" :size="12" />{{ f.name }}
                </span>
              </div>
              <div
                v-if="m.role === 'assistant' && !m.error && m.text"
                class="md-body"
                dir="auto"
                v-html="mdToHtml(m.text)"
                @click="onMsgClick"
              ></div>
              <p v-else-if="m.text" class="msg-text" dir="auto">{{ m.text }}</p>
            </div>
            <button
              v-if="m.role === 'assistant' && !m.error && m.text"
              class="copy-out"
              :title="t('toast.copied')"
              @click="copyMsg(m)"
            >
              <Icon name="copy" :size="14" />
            </button>
          </div>

          <!-- Permission cards: the agent paused mid-turn and waits for a decision -->
          <div v-for="p in agentPending" :key="p.callId" class="msg assistant">
            <div class="avatar assistant"><Icon name="logs" :size="15" /></div>
            <div class="bubble perm-bubble">
              <div class="perm-title"><Icon name="logs" :size="14" />{{ t('chat.tool_wants') }}</div>
              <div class="perm-detail" dir="auto">
                <b>{{ p.tool || 'tool' }}</b>
                <span v-if="p.display && toolSummary(p)"> · {{ toolSummary(p) }}</span>
              </div>
              <div class="perm-actions">
                <button class="perm-allow" @click="decidePermission(p.callId, true)">{{ t('chat.tool_allow') }}</button>
                <button class="perm-always" @click="decidePermission(p.callId, 'always')">{{ t('chat.tool_always') }}</button>
                <button class="perm-deny" @click="decidePermission(p.callId, false)">{{ t('chat.tool_deny') }}</button>
              </div>
            </div>
          </div>

          <div v-if="sending" class="msg assistant">
            <div class="avatar assistant"><Icon name="chat" :size="15" /></div>
            <div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>
          </div>
        </div>

        <div class="composer">
          <div class="composer-tools">
            <span
              class="ws-chip"
              :class="{ clickable: agentWorkspace }"
              :title="agentWorkspace || t('chat.ws_title')"
              @click="openWorkspace"
            >
              <Icon name="folder" :size="13" />
              <span class="ws-name">{{ workspaceName }}</span>
            </span>
            <span class="ct-label">{{ t('settings.interface_config') }}</span>
            <div class="ct-prov">
              <Dropdown v-model="chatProviderId" :options="providerOptions" size="sm" :placeholder="t('chat.select_provider')" />
            </div>
            <span class="ct-label">{{ t('settings.model') }}</span>
            <div class="ct-model">
              <Dropdown v-model="chatModel" :options="modelOptions" size="sm" :placeholder="t('chat.select_model')" />
            </div>
            <span class="ct-label">{{ t('chat.tool_mode') }}</span>
            <div class="ct-mode" :title="t('chat.tool_mode_hint')">
              <Dropdown v-model="toolMode" :options="toolModeOptions" size="sm" />
            </div>
          </div>
          <div v-if="attachments.length" class="attach-row">
            <div v-for="(a, i) in attachments" :key="i" class="attach">
              <img v-if="a.kind === 'image'" :src="a.dataUrl" alt="" />
              <span v-else class="attach-file"><Icon name="logs" :size="13" />{{ a.name }}</span>
              <button class="attach-x" @click="removeAttachment(i)"><Icon name="win-close" :size="10" /></button>
            </div>
          </div>
          <div class="composer-main">
            <input ref="fileInput" type="file" multiple accept="image/*,.txt,.md,.json,.csv,.log,.js,.ts,.py,.html,.css,.xml,.yml,.yaml" hidden @change="onPickFile" />
            <button class="attach-btn" :title="t('chat.file_tag')" :disabled="!configured" @click="fileInput && fileInput.click()">
              <Icon name="image" :size="18" />
            </button>
            <textarea
              v-model="input"
              class="chat-input"
              dir="auto"
              rows="1"
              :placeholder="configured ? t('chat.send_placeholder') : t('settings.not_configured')"
              :disabled="!configured || sending"
              @keydown="onKeydown"
            ></textarea>
            <button v-if="sending" class="send-btn stop" :title="t('chat.stop_generating')" @click="stop">
              <Icon name="stop" :size="18" />
            </button>
            <button
              v-else
              class="send-btn"
              :disabled="!input.trim() && !attachments.length"
              @click="send"
            >
              <Icon name="sparkle" :size="16" />
            </button>
          </div>
        </div>
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
  gap: 14px;
  padding: 16px 30px 14px;
  border-bottom: 1px solid var(--border);
}
.head-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ghost-icon {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  display: grid;
  place-items: center;
  color: var(--text-2);
  border: 1px solid var(--border);
}
.ghost-icon:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--text);
}
.ghost-icon:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ghost-icon.on {
  color: var(--accent);
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.head-title h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
.sub {
  margin: 3px 0 0;
  color: var(--text-3);
  font-size: 12.5px;
}
.head-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.model-wrap {
  width: 200px;
  flex-shrink: 0;
}

.chat-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.conv-list {
  width: 232px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  background: var(--bg-2);
}
.new-conv {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin: 12px;
  height: 36px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  color: var(--on-accent, #fff);
  background: var(--accent);
  box-shadow: 0 4px 12px var(--accent-glow);
}
.new-conv:hover {
  background: var(--accent-hover);
}
.conv-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.conv-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  text-align: start;
  color: var(--text-2);
  transition: background 0.12s ease, color 0.12s ease;
}
.conv-item:hover {
  background: var(--surface-2);
  color: var(--text);
}
.conv-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.conv-ic {
  flex-shrink: 0;
  opacity: 0.7;
}
.conv-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.conv-title {
  font-size: 12.5px;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conv-meta {
  font-size: 10.5px;
  color: var(--text-3);
}
.conv-del {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: var(--text-3);
  opacity: 0;
}
.conv-item:hover .conv-del {
  opacity: 1;
}
.conv-del:hover {
  background: rgba(225, 29, 72, 0.12);
  color: var(--danger);
}
.conv-empty {
  margin: auto;
  padding: 20px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
  color: var(--text-3);
}
.conv-empty span {
  font-size: 12.5px;
  color: var(--text-2);
}
.conv-empty small {
  font-size: 11px;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 22px 30px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.empty {
  margin: auto;
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
  margin: 16px 0 6px;
  font-weight: 600;
}
.empty-sub {
  font-size: 12.5px;
  line-height: 1.7;
  margin: 0;
}
.empty-sub b {
  color: var(--accent);
}
.msg {
  display: flex;
  gap: 11px;
  width: 100%;
}
.msg.user {
  flex-direction: row-reverse;
}
.avatar {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 9px;
  display: grid;
  place-items: center;
  color: var(--on-accent, #fff);
}
.avatar.assistant {
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
}
.avatar.user {
  background: var(--surface-2);
  color: var(--text-2);
  border: 1px solid var(--border);
}
.bubble {
  position: relative;
  max-width: min(760px, 80%);
  padding: 11px 14px;
  border-radius: 14px;
  font-size: 13.5px;
  line-height: 1.65;
}
.msg.assistant .bubble {
  background: var(--surface);
  border: 1px solid var(--border);
  border-top-left-radius: 4px;
}
.msg.user .bubble {
  background: var(--accent);
  color: var(--on-accent, #fff);
  border-top-right-radius: 4px;
}
.bubble.error {
  background: rgba(225, 29, 72, 0.1);
  border: 1px solid rgba(225, 29, 72, 0.35);
  color: var(--danger);
}
.msg-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
.think {
  margin: 0 0 8px;
}
.think-head {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 12px;
  color: var(--text-3);
  cursor: pointer;
}
.think-head:hover {
  color: var(--text-2);
}
.think-chev {
  display: inline-block;
  font-size: 10px;
  transition: transform 0.15s ease;
}
.think-chev.open {
  transform: rotate(90deg);
}
.think-body {
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--text-3);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 260px;
  overflow-y: auto;
  user-select: text;
}
.msg-imgs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.msg-imgs img {
  max-width: 180px;
  max-height: 180px;
  border-radius: 8px;
  display: block;
}
.msg-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  padding: 3px 8px;
  border-radius: 999px;
  /* Follows the bubble text color as a base; visible on accent bubbles in both light and dark themes */
  background: color-mix(in srgb, currentColor 16%, transparent);
}
.msg.assistant .file-chip {
  background: var(--surface-2);
  color: var(--text-2);
}
.copy-out {
  align-self: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: var(--text-3);
  opacity: 0;
  transition: opacity 0.14s ease, background 0.14s ease;
}
.msg:hover .copy-out {
  opacity: 1;
}
.copy-out:hover {
  background: var(--surface-2);
  color: var(--text);
}
.md-body {
  user-select: text;
  font-size: 13.5px;
  line-height: 1.65;
  word-break: break-word;
}
.md-body :deep(p) {
  margin: 0 0 8px;
}
.md-body :deep(p:last-child) {
  margin-bottom: 0;
}
.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3) {
  margin: 10px 0 6px;
  font-size: 15px;
}
.md-body :deep(ul),
.md-body :deep(ol) {
  margin: 6px 0;
  padding-left: 20px;
}
.md-body :deep(li) {
  margin: 3px 0;
}
.md-body :deep(code) {
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 12.5px;
}
.md-body :deep(pre) {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.md-body :deep(pre code) {
  background: none;
  padding: 0;
}
.md-body :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
}
.md-body :deep(strong) {
  font-weight: 700;
}
.md-body :deep(blockquote) {
  border-left: 3px solid var(--border-2);
  margin: 8px 0;
  padding-left: 12px;
  color: var(--text-2);
}
.md-body :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
}
.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid var(--border);
  padding: 4px 8px;
  font-size: 12.5px;
}
.typing {
  display: inline-flex;
  gap: 4px;
  padding: 2px 0;
}
.typing i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-3);
  animation: blink 1.2s infinite both;
}
.typing i:nth-child(2) {
  animation-delay: 0.2s;
}
.typing i:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes blink {
  0%, 80%, 100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}
.composer {
  border-top: 1px solid var(--border);
  padding: 12px 30px 16px;
}
.composer-tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 10px;
}
.ct-label {
  font-size: 12px;
  color: var(--text-3);
}
.ws-chip {
  margin-right: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 320px;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-3);
  font-size: 12px;
}
.ws-chip.clickable {
  cursor: pointer;
}
.ws-chip.clickable:hover {
  color: var(--text-2);
  border-color: var(--accent);
}
.ws-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ct-prov {
  width: 150px;
}
.ct-model {
  width: 185px;
}
.ct-mode {
  width: 150px;
}
.attach-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.attach {
  position: relative;
}
.attach img {
  width: 52px;
  height: 52px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--border);
  display: block;
}
.attach-file {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 52px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-2);
}
.attach-x {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
}
.attach-x:hover {
  background: var(--danger);
}
.composer-main {
  display: flex;
  align-items: flex-end;
  gap: 9px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 8px 8px 10px;
}
.composer-main:focus-within {
  border-color: var(--accent-line);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.attach-btn {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  display: grid;
  place-items: center;
  color: var(--text-2);
}
.attach-btn:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--accent);
}
.attach-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.chat-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  max-height: 160px;
  padding: 9px 2px;
  outline: none;
  user-select: text;
}
.chat-input::placeholder {
  color: var(--text-3);
}
.send-btn {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  display: grid;
  place-items: center;
  color: var(--on-accent, #fff);
  background: var(--accent);
  box-shadow: 0 4px 12px var(--accent-glow);
}
.send-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}
.send-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
}
.msg.tool .bubble.tool-bubble {
  padding: 6px 12px;
  max-width: min(720px, 88%);
  background: var(--surface-2, var(--surface));
  /* slightly darker than a normal assistant bubble, theme-aware */
  background: color-mix(in srgb, var(--surface) 88%, var(--text));
  border: 1px solid var(--border);
  border-radius: 14px;
  border-top-left-radius: 4px;
}
/* executing tool calls: slightly dimmed with a soft accent glow pulse */
.tool-bubble.running {
  opacity: 0.72;
  animation: tool-glow 1.6s ease-in-out infinite;
}
.tool-bubble.running:hover {
  opacity: 1;
}
@keyframes tool-glow {
  0%, 100% { box-shadow: 0 0 0 0 transparent; }
  50% { box-shadow: 0 0 10px 2px color-mix(in srgb, var(--accent) 45%, transparent); }
}
.tool-bubble.denied .tool-state {
  color: var(--text-3, inherit);
  opacity: 0.8;
}
.tool-bubble .tool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 0;
  background: none;
  border: none;
  color: inherit;
  font-family: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
  opacity: 0.75;
  min-width: 0;
}
.tool-bubble .tool-head:hover {
  opacity: 1;
}
.tool-chev {
  display: inline-block;
  font-size: 10px;
  transition: transform 0.15s ease;
}
.tool-chev.open {
  transform: rotate(90deg);
}
.tool-bubble .tool-kind {
  flex: none;
  font-weight: 600;
}
.tool-bubble .tool-detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  unicode-bidi: plaintext;
}
.tool-bubble .tool-state {
  flex: none;
  margin-left: auto;
}
.tool-bubble.ok .tool-state {
  color: #34a853;
}
.tool-bubble.error .tool-state {
  color: #ea4335;
}
.tool-bubble .tool-result {
  margin-top: 5px;
  font-size: 11px;
  opacity: 0.66;
  max-height: 84px;
  overflow: auto;
  word-break: break-word;
  white-space: pre-wrap;
}
.perm-bubble {
  min-width: 250px;
  max-width: min(560px, 88%);
}
.perm-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
}
.perm-detail {
  margin-top: 5px;
  font-size: 11.5px;
  opacity: 0.8;
  word-break: break-word;
}
.perm-actions {
  display: flex;
  gap: 8px;
  margin-top: 9px;
}
.perm-actions button {
  border: none;
  border-radius: 7px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.perm-allow {
  background: var(--accent, #4c8dff);
  color: #fff;
}
.perm-always {
  background: transparent;
  color: var(--accent, #4c8dff);
  border: 1px solid var(--accent, #4c8dff);
}
.perm-always:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.perm-deny {
  background: var(--surface-2, rgba(127, 127, 127, 0.14));
  color: inherit;
}

.send-btn.stop {
  background: var(--danger);
  box-shadow: none;
}
.send-btn.stop:hover {
  opacity: 0.9;
}
</style>
