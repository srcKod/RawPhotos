import { app, shell, BrowserWindow, ipcMain, dialog, protocol, net, Tray, Menu, Notification } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { pathToFileURL } from 'node:url'
import icon from '../../resources/icon.png?asset'
import { setLocale, m } from './i18n'

let mainWindow = null
let tray = null

// One interface config (one provider / one proxy instance). Image and video
// models are separate fields because the same proxy often uses different model
// names for images vs videos.
function makeProvider(patch = {}) {
  return {
    id: patch.id || `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: patch.name || m('main.new_interface'),
    baseUrl: patch.baseUrl || '',
    apiKey: patch.apiKey || '',
    imageModel: patch.imageModel || '',
    videoModel: patch.videoModel || '',
    optimizeModel: patch.optimizeModel || '',
    imageSize: patch.imageSize || '',
    videoSize: patch.videoSize || '',
    videoSeconds: patch.videoSeconds || '',
    // Advanced: endpoint paths are adjustable per platform (most OpenAI-compatible proxies need no change)
    editPath: patch.editPath || '/images/edits',
    videoPath: patch.videoPath || '/videos/generations',
    videoPollPath: patch.videoPollPath || '',
    // '' = legacy /videos/generations style; 'openai-videos' = OpenAI Videos API (POST /videos + video_id, e.g. Agnes);
    // 'openai-videos-strict' = Sora-compatible strict body (only model/prompt top-level, rest in extra_body, e.g. Google Gemini)
    videoApi: patch.videoApi || ''
  }
}

const DEFAULT_SETTINGS = {
  providers: [],
  activeProviderId: '',
  defaultCount: 1,
  saveDir: '',
  theme: 'sky',
  customColor: '#10b981',
  closeAction: 'ask',
  chatModel: '',
  chatProviderId: '',
  alertEnabled: false,
  alertThreshold: 5
}

function settingsFile() {
  return join(app.getPath('userData'), 'settings.json')
}

function defaultSaveDir() {
  return join(app.getPath('pictures'), 'RawPhotos')
}

// Migrate the legacy single-interface flat config into the multi-interface
// structure so existing users keep their settings on upgrade.
function migrate(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) }
  if (!Array.isArray(s.providers) || s.providers.length === 0) {
    const seeded = []
    // Relay/aggregator proxies, not local services — naming and defaults follow the "relay interface" convention
    if (raw && (raw.baseUrl || raw.model || raw.apiKey)) {
      seeded.push(
        makeProvider({
          name: m('main.relay_interface'),
          baseUrl: raw.baseUrl || '',
          apiKey: raw.apiKey || '',
          imageModel: raw.model || 'grok-imagine-image',
          imageSize: raw.size || ''
        })
      )
    }
    // apimf flux relay preset so users only need to paste a key
    seeded.push(
      makeProvider({
        name: m('main.preset_apimf_flux'),
        baseUrl: 'https://kiro.apimf.top/v1',
        imageModel: 'flux',
        imageSize: '1024x1024'
      })
    )
    s.providers = seeded
  }
  // apimf main-site GPT image endpoint (gpt-image-2, OpenAI images/generations format)
  // as an out-of-the-box preset; idempotently added for existing configs too — just paste a key.
  if (!s.providers.some((p) => String(p.baseUrl || '').includes('nexus.apimf.top'))) {
    s.providers.push(
      makeProvider({
        name: m('main.preset_apimf_main'),
        baseUrl: 'https://nexus.apimf.top/v1',
        imageModel: 'gpt-image-2',
        imageSize: '1024x1024'
      })
    )
  }
  // Google Gemini official OpenAI-compat endpoint: images via /images/generations
  // (gemini-2.5-flash-image returns b64_json), video via the Sora-style /videos
  // surface (veo) handled by the openai-videos-strict adapter — the strict body is
  // required because Google rejects unknown top-level fields like `mode` with 400.
  // Idempotent — paste a key.
  if (!s.providers.some((p) => String(p.baseUrl || '').includes('generativelanguage.googleapis.com'))) {
    s.providers.push(
      makeProvider({
        name: m('main.preset_google'),
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        imageModel: 'gemini-2.5-flash-image',
        videoModel: 'veo-3.1-generate-preview',
        videoApi: 'openai-videos-strict',
        videoPath: '/videos'
      })
    )
  }
  // Volcano Ark (ByteDance): Seedream image models speak the OpenAI images format.
  // Seedance video uses Ark's own contents/generations/tasks API (incompatible with
  // both video adapters for now), so video stays unconfigured on this preset.
  if (!s.providers.some((p) => String(p.baseUrl || '').includes('ark.cn-beijing.volces.com'))) {
    s.providers.push(
      makeProvider({
        name: m('main.preset_ark'),
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        imageModel: 'doubao-seedream-4-0-250828'
      })
    )
  }
  // Field completion + historical value fixes
  s.providers = s.providers.map((p) => {
    const fixed = makeProvider(p)
    // Rename the legacy auto-named local CLIProxyAPI provider to the standard relay name —
    // the comparison literal stays Chinese on purpose: it matches stored legacy settings.
    if (fixed.name === '本地 CLIProxyAPI') fixed.name = m('main.relay_interface')
    // Self-heal: the Google preset originally shipped with the Agnes-style openai-videos
    // adapter, whose top-level `mode`/`seconds` fields Google's strict surface rejects with
    // 400 INVALID_ARGUMENT. Upgrade saved copies to the strict variant.
    if (String(fixed.baseUrl || '').includes('generativelanguage.googleapis.com') && fixed.videoApi === 'openai-videos') fixed.videoApi = 'openai-videos-strict'
    // Legacy default grok-2-image is unsupported on most relays; fix to the confirmed Grok Imagine image model
    if (fixed.imageModel === 'grok-2-image') fixed.imageModel = 'grok-imagine-image'
    // When no video model is set, default to the same family so video works out of the box (changeable in Settings)
    if (!fixed.videoModel) fixed.videoModel = 'grok-imagine-video'
    return fixed
  })
  if (!s.activeProviderId || !s.providers.some((p) => p.id === s.activeProviderId)) {
    s.activeProviderId = s.providers[0].id
  }
  if (!['green', 'sky', 'dark', 'custom'].includes(s.theme)) s.theme = 'sky'
  delete s.baseUrl
  delete s.apiKey
  delete s.model
  delete s.size
  return s
}

async function readSettings() {
  try {
    const raw = JSON.parse(await fs.readFile(settingsFile(), 'utf-8'))
    const s = migrate(raw)
    setLocale(s.language) // keep main-process message language in sync with the UI
    return s
  } catch {
    return migrate(null)
  }
}

async function writeSettings(patch) {
  const next = { ...(await readSettings()), ...(patch || {}) }
  const clean = migrate(next)
  setLocale(clean.language)
  await fs.writeFile(settingsFile(), JSON.stringify(clean, null, 2), 'utf-8')
  return clean
}

function activeProvider(settings) {
  return (
    settings.providers.find((p) => p.id === settings.activeProviderId) ||
    settings.providers[0] ||
    makeProvider()
  )
}

function normalizeBaseUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Unified JSON request: timeout, auth, and error cleanup all live here.
async function requestJson(url, { method = 'GET', apiKey = '', body = null, timeoutMs = 60000, signal = null } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  let res
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      throw new Error(m('main.err_timeout_hint', { seconds: Math.round(timeoutMs / 1000) }))
    }
    throw new Error(m('main.err_request_failed', { message: err.message }))
  }
  clearTimeout(timer)

  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try {
      msg = JSON.parse(text)?.error?.message || msg
    } catch {
      // keep the raw text for detail reporting
    }
    const err = new Error(m('main.err_http_status', { status: res.status, message: String(msg).slice(0, 800) }))
    err.status = res.status
    err.responseText = String(text).slice(0, 2000)
    throw err
  }
  try {
    return { status: res.status, json: JSON.parse(text) }
  } catch {
    throw new Error(m('main.err_non_json', { text: text.slice(0, 300) }))
  }
}

// Image-to-image uses multipart (/images/edits), separate from the JSON requestJson.
// Errors also carry status/responseText.
async function requestMultipart(url, { apiKey = '', form, timeoutMs = 180000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body: form,
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') throw new Error(m('main.err_timeout', { seconds: Math.round(timeoutMs / 1000) }))
    throw new Error(m('main.err_request_failed', { message: err.message }))
  }
  clearTimeout(timer)
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try {
      msg = JSON.parse(text)?.error?.message || msg
    } catch {
      // keep the raw text for detail reporting
    }
    const err = new Error(m('main.err_http_status', { status: res.status, message: String(msg).slice(0, 800) }))
    err.status = res.status
    err.responseText = String(text).slice(0, 2000)
    throw err
  }
  try {
    return { status: res.status, json: JSON.parse(text) }
  } catch {
    throw new Error(m('main.err_non_json', { text: text.slice(0, 300) }))
  }
}

// Extract media (image/video) URLs or base64 from the many possible response
// shapes. Compatible with the OpenAI data[] structure plus the flat/nested
// variants some proxies return.
function pickMediaItems(json) {
  const out = []
  const push = (b64, url, extra = {}) => {
    if (b64 || url) out.push({ b64: b64 || null, url: url || null, ...extra })
  }
  const data = Array.isArray(json?.data) ? json.data : []
  for (const d of data) {
    push(d.b64_json || d.b64 || null, d.url || d.video_url || null, {
      revisedPrompt: d.revised_prompt || null
    })
  }
  if (!out.length) {
    if (typeof json?.url === 'string') push(null, json.url)
    if (typeof json?.video_url === 'string') push(null, json.video_url)
    if (json?.video && typeof json.video.url === 'string') push(null, json.video.url)
    if (json?.data && typeof json.data.url === 'string') push(null, json.data.url)
    if (json?.result && typeof json.result.url === 'string') push(null, json.result.url)
    // OpenAI Videos style (e.g. Agnes): the finished media URL lives in metadata.url;
    // an empty value before completion is ignored by the truthy check in push()
    if (json?.metadata && typeof json.metadata.url === 'string') push(null, json.metadata.url)
    if (typeof json?.output === 'string') push(null, json.output)
    if (Array.isArray(json?.output)) {
      json.output.forEach((u) => typeof u === 'string' && push(null, u))
    }
  }
  return out
}

const TERMINAL_OK = ['succeeded', 'success', 'completed', 'complete', 'finished', 'done', 'ok']
const TERMINAL_BAD = ['failed', 'error', 'errored', 'canceled', 'cancelled', 'rejected']

// Async video jobs: some proxies return a task ID first and need polling until
// the URL is ready. Status/field names differ per provider, so stay lenient:
// return as soon as media appears, fail on terminal-bad status, cap at timeout.
async function pollVideoJob(baseUrl, provider, jobId) {
  const tmpl = provider.videoPollPath
    ? provider.videoPollPath
    : `${normalizeBaseUrl(provider.videoPath) || '/videos/generations'}/{id}`
  const pollPath = tmpl.includes('{id}') ? tmpl.replace('{id}', encodeURIComponent(jobId)) : `${tmpl.replace(/\/+$/, '')}/${encodeURIComponent(jobId)}`
  const pollUrl = pollPath.startsWith('http') ? pollPath : `${baseUrl}${pollPath.startsWith('/') ? '' : '/'}${pollPath}`

  const deadline = Date.now() + 600000
  let delay = 3000
  while (Date.now() < deadline) {
    await sleep(delay)
    let json
    try {
      ({ json } = await requestJson(pollUrl, { apiKey: provider.apiKey, timeoutMs: 30000 }))
    } catch (err) {
      // transient errors during polling are not fatal; keep retrying until the deadline
      delay = Math.min(delay + 1500, 9000)
      continue
    }
    const items = pickMediaItems(json)
    if (items.length) return items
    const status = String(json.status || json?.data?.status || json?.result?.status || '').toLowerCase()
    if (TERMINAL_BAD.includes(status)) {
      // Google's compat layer reports failures as a bare string on `error`; others nest {message}
      const reason = json?.error?.message || (typeof json?.error === 'string' && json.error) || json?.message || status
      throw new Error(m('main.err_video_task_failed', { reason: String(reason).slice(0, 300) }))
    }
    delay = Math.min(delay + 1000, 9000)
  }
  throw new Error(m('main.err_video_timeout'))
}

async function toBuffer({ b64, url, path }) {
  if (b64) return Buffer.from(b64, 'base64')
  if (path) return fs.readFile(path)
  if (url) {
    const r = await fetch(url)
    if (!r.ok) throw new Error(m('main.err_download_failed', { status: r.status }))
    return Buffer.from(await r.arrayBuffer())
  }
  throw new Error(m('main.err_no_media'))
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp)$/i
const VIDEO_RE = /\.(mp4|webm|mov|mkv|m4v)$/i

function mimeOf(name) {
  const ext = String(name).split('.').pop().toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/png'
}

function defaultExt(kind) {
  return kind === 'video' ? 'mp4' : 'png'
}

// Runtime logs: in-memory ring buffer (for the Logs page) + appended to
// userData/rawphotos.log (shareable for troubleshooting).
const LOG_MAX = 300
const logs = []
let logSeq = 0

function logFile() {
  return join(app.getPath('userData'), 'rawphotos.log')
}

function pushLog(entry) {
  const e = { id: ++logSeq, time: Date.now(), ...entry }
  logs.unshift(e)
  if (logs.length > LOG_MAX) logs.length = LOG_MAX
  // JSONL: one full JSON object per line so entries (incl. detail) survive restarts — not just human-readable text
  fs.appendFile(logFile(), JSON.stringify(e) + '\n', 'utf-8').catch(() => {})
  recordUsage(e)
  mainWindow?.webContents?.send('logs:new', e)
  return e
}

// Cumulative usage stats: independent of the 300-entry log ring buffer;
// long-term totals persisted to userData/rawphotos-usage.json
function freshUsage() {
  return { byKind: {}, byModel: {}, byDay: {}, ok: 0, fail: 0, firstAt: null }
}
let usage = freshUsage()
let usageTimer = null

function usageFile() {
  return join(app.getPath('userData'), 'rawphotos-usage.json')
}
function saveUsage() {
  clearTimeout(usageTimer)
  usageTimer = setTimeout(() => {
    fs.writeFile(usageFile(), JSON.stringify(usage), 'utf-8').catch(() => {})
  }, 600)
}
async function loadUsage() {
  try {
    const o = JSON.parse(await fs.readFile(usageFile(), 'utf-8'))
    usage = {
      ...freshUsage(),
      ...o,
      byKind: { ...(o.byKind || {}) },
      byModel: { ...(o.byModel || {}) },
      byDay: { ...(o.byDay || {}) }
    }
  } catch {
    usage = freshUsage()
  }
}
function recordUsage(e) {
  usage.byKind[e.kind] = (usage.byKind[e.kind] || 0) + 1
  if (e.ok) usage.ok += 1
  else usage.fail += 1
  if (e.model) usage.byModel[e.model] = (usage.byModel[e.model] || 0) + 1
  const day = new Date(e.time).toISOString().slice(0, 10)
  usage.byDay[day] = (usage.byDay[day] || 0) + 1
  if (!usage.firstAt) usage.firstAt = e.time
  saveUsage()
}

// On startup, load the most recent LOG_MAX lines from the log file into memory
// so the Logs page is not empty after a relaunch; also trim the file to prevent growth.
async function loadLogsFromFile() {
  try {
    const raw = await fs.readFile(logFile(), 'utf-8')
    const lines = raw.split('\n').filter((l) => l.trim()).slice(-LOG_MAX)
    const parsed = []
    for (const ln of lines) {
      try {
        const o = JSON.parse(ln)
        if (o && o.kind) parsed.push(o)
      } catch {
        // skip history lines that cannot be parsed (old text format)
      }
    }
    logs.length = 0
    logs.push(...[...parsed].reverse()) // file is oldest→newest; memory wants newest→oldest
    logSeq = logs.reduce((m, e) => Math.max(m, e.id || 0), 0)
    // trim the file to these recent entries (keeping oldest→newest order)
    await fs
      .writeFile(logFile(), parsed.map((e) => JSON.stringify(e)).join('\n') + (parsed.length ? '\n' : ''), 'utf-8')
      .catch(() => {})
  } catch {
    // file missing / read failed: keep in-memory logs empty
  }
}

// Controller for the in-flight chat request (used by "Stop Generating")
let activeChatAbort = null

// AI chat history: persisted to userData/rawphotos-chats.json (each conversation keeps full messages)
let chats = []
const CHATS_MAX = 80

function chatsFile() {
  return join(app.getPath('userData'), 'rawphotos-chats.json')
}
// Flush to disk immediately (no debounce) so quick quits/switches cannot lose conversations
async function saveChatsFile() {
  await fs.writeFile(chatsFile(), JSON.stringify(chats), 'utf-8').catch(() => {})
}
async function loadChats() {
  try {
    const o = JSON.parse(await fs.readFile(chatsFile(), 'utf-8'))
    chats = Array.isArray(o) ? o : Array.isArray(o.conversations) ? o.conversations : []
  } catch {
    chats = []
  }
}

function registerIpc() {
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximizeToggle', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  // Close (X) hides to the system tray instead of quitting; the app keeps running in the background
  ipcMain.on('window:close', () => mainWindow?.hide())
  ipcMain.on('app:quit', () => app.quit())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  ipcMain.handle('settings:get', async () => readSettings())
  ipcMain.handle('settings:set', async (_e, patch) => writeSettings(patch))

  // Test connection: fires directly against the given provider config, no "save first" needed.
  ipcMain.handle('connection:test', async (_e, provider = {}) => {
    const baseUrl = normalizeBaseUrl(provider.baseUrl)
    const url = `${baseUrl}/models`
    const t0 = Date.now()
    try {
      if (!baseUrl) throw new Error(m('main.err_fill_base_url'))
      let res
      try {
        res = await fetch(url, {
          headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}
        })
      } catch (err) {
        throw new Error(m('main.err_cannot_connect', { url: baseUrl, message: err.message }))
      }
      if (res.status === 401 || res.status === 403) {
        const e = new Error(m('main.err_auth_failed', { status: res.status }))
        e.status = res.status
        throw e
      }
      let models = []
      try {
        const json = JSON.parse(await res.text())
        const arr = json.data || json.models || []
        models = arr.map((m) => m.id || m.name).filter(Boolean)
      } catch {
        // some proxies return a non-standard /models structure; a successful connection is good enough
      }
      pushLog({ kind: 'test', ok: true, provider: provider.name, url, status: res.status, durationMs: Date.now() - t0, message: m('main.log_test_ok', { count: models.length }) })
      return { ok: true, status: res.status, models }
    } catch (err) {
      pushLog({ kind: 'test', ok: false, provider: provider.name, url, status: err.status, durationMs: Date.now() - t0, message: err.message })
      throw err
    }
  })

  // Silently fetch the model list (auto-fills the Settings dropdowns); no logging and an empty
  // result on failure, to keep noise down.
  ipcMain.handle('models:list', async (_e, provider = {}) => {
    const baseUrl = normalizeBaseUrl(provider.baseUrl)
    if (!baseUrl) return { models: [] }
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}
      })
      const json = JSON.parse(await res.text())
      const arr = json.data || json.models || []
      return { models: arr.map((m) => m.id || m.name).filter(Boolean) }
    } catch {
      return { models: [] }
    }
  })

  ipcMain.handle('image:generate', async (_e, payload = {}) => {
    const settings = await readSettings()
    const provider = activeProvider(settings)
    const baseUrl = normalizeBaseUrl(provider.baseUrl)
    const model = payload.model || provider.imageModel
    const url = `${baseUrl}/images/generations`
    const t0 = Date.now()
    try {
      if (!baseUrl) throw new Error(m('main.err_no_endpoint'))
      const prompt = String(payload.prompt || '').trim()
      if (!prompt) throw new Error(m('main.err_enter_prompt'))
      if (!model) throw new Error(m('main.err_fill_image_model'))

      const body = {
        model,
        prompt,
        n: Math.min(Math.max(parseInt(payload.n, 10) || 1, 1), 10),
        response_format: 'b64_json'
      }
      const size = payload.size || provider.imageSize
      if (size) body.size = size

      const { json } = await requestJson(url, {
        method: 'POST',
        apiKey: provider.apiKey,
        body,
        timeoutMs: 180000
      })
      const images = pickMediaItems(json)
      if (!images.length) throw new Error(m('main.err_no_images'))
      pushLog({ kind: 'image', ok: true, provider: provider.name, model, url, status: 200, durationMs: Date.now() - t0, message: m('main.log_image_ok', { count: images.length }) })
      return { images, model, prompt }
    } catch (err) {
      pushLog({ kind: 'image', ok: false, provider: provider.name, model, url, status: err.status, durationMs: Date.now() - t0, message: err.message, detail: err.responseText })
      throw err
    }
  })

  // Image-to-image: reference image + prompt via /images/edits (multipart)
  ipcMain.handle('image:edit', async (_e, payload = {}) => {
    const settings = await readSettings()
    const provider = activeProvider(settings)
    const baseUrl = normalizeBaseUrl(provider.baseUrl)
    const model = payload.model || provider.imageModel
    const editPath = normalizeBaseUrl(provider.editPath) || '/images/edits'
    const url = `${baseUrl}${editPath.startsWith('/') ? '' : '/'}${editPath}`
    const t0 = Date.now()
    try {
      if (!baseUrl) throw new Error(m('main.err_no_endpoint'))
      const prompt = String(payload.prompt || '').trim()
      if (!prompt) throw new Error(m('main.err_enter_prompt'))
      if (!model) throw new Error(m('main.err_fill_image_model'))
      if (!payload.imageB64) throw new Error(m('main.err_select_ref_image'))

      const buffer = Buffer.from(payload.imageB64, 'base64')
      const name = payload.imageName || 'image.png'
      const form = new FormData()
      form.append('model', model)
      form.append('prompt', prompt)
      form.append('n', String(Math.min(Math.max(parseInt(payload.n, 10) || 1, 1), 10)))
      form.append('response_format', 'b64_json')
      const size = payload.size || provider.imageSize
      if (size) form.append('size', size)
      form.append('image', new Blob([buffer], { type: mimeOf(name) }), name)

      const { json } = await requestMultipart(url, {
        apiKey: provider.apiKey,
        form,
        timeoutMs: 180000
      })
      const images = pickMediaItems(json)
      if (!images.length) throw new Error(m('main.err_no_images'))
      pushLog({ kind: 'image', ok: true, provider: provider.name, model, url, status: 200, durationMs: Date.now() - t0, message: m('main.log_img2img_ok', { count: images.length }) })
      return { images, model, prompt }
    } catch (err) {
      pushLog({ kind: 'image', ok: false, provider: provider.name, model, url, status: err.status, durationMs: Date.now() - t0, message: err.message, detail: err.responseText })
      throw err
    }
  })

  // Desktop AI chat: forward the full messages array (vision content arrays supported) to /chat/completions
  ipcMain.handle('chat:send', async (_e, payload = {}) => {
    const settings = await readSettings()
    const provider =
      (payload.providerId && settings.providers.find((p) => p.id === payload.providerId)) ||
      activeProvider(settings)
    const baseUrl = normalizeBaseUrl(provider.baseUrl)
    const model = payload.model || provider.optimizeModel
    const url = `${baseUrl}/chat/completions`
    const t0 = Date.now()
    const ctrl = new AbortController()
    activeChatAbort = ctrl
    try {
      if (!baseUrl) throw new Error(m('main.err_no_endpoint'))
      if (!model) throw new Error(m('main.err_pick_chat_model'))
      const messages = Array.isArray(payload.messages) ? payload.messages : []
      if (!messages.length) throw new Error(m('main.err_no_messages'))

      const { json } = await requestJson(url, {
        method: 'POST',
        apiKey: provider.apiKey,
        body: { model, messages, temperature: payload.temperature ?? 0.7 },
        timeoutMs: 120000,
        signal: ctrl.signal
      })
      const content = json?.choices?.[0]?.message?.content
      if (content == null) throw new Error(m('main.err_no_content'))
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.map((c) => c?.text || '').join('')
            : String(content)
      pushLog({ kind: 'chat', ok: true, provider: provider.name, model, url, status: 200, durationMs: Date.now() - t0, message: m('main.log_chat_ok') })
      return { content: text }
    } catch (err) {
      if (ctrl.userAborted) {
        pushLog({ kind: 'chat', ok: false, provider: provider.name, model, url, durationMs: Date.now() - t0, message: m('main.log_stopped') })
        const e = new Error(m('main.log_stopped'))
        e.aborted = true
        throw e
      }
      pushLog({ kind: 'chat', ok: false, provider: provider.name, model, url, status: err.status, durationMs: Date.now() - t0, message: err.message, detail: err.responseText })
      throw err
    } finally {
      if (activeChatAbort === ctrl) activeChatAbort = null
    }
  })

  ipcMain.handle('chat:abort', async () => {
    if (activeChatAbort) {
      activeChatAbort.userAborted = true
      activeChatAbort.abort()
    }
    return true
  })

  // Expand a prompt into something more concrete using a chat model (gpt / claude / grok, OpenAI-compatible).
  ipcMain.handle('prompt:optimize', async (_e, payload = {}) => {
    const settings = await readSettings()
    const provider = activeProvider(settings)
    const baseUrl = normalizeBaseUrl(provider.baseUrl)
    const model = provider.optimizeModel
    const url = `${baseUrl}/chat/completions`
    const t0 = Date.now()
    try {
      if (!baseUrl) throw new Error(m('main.err_no_endpoint'))
      const text = String(payload.prompt || '').trim()
      if (!text) throw new Error(m('main.err_enter_prompt_first'))
      if (!model) {
        throw new Error(m('main.err_fill_optimize_model'))
      }

      const forVideo = payload.mode === 'video'
      const system = forVideo
        ? m('main.prompt_video_system')
        : m('main.prompt_image_system')

      const { json } = await requestJson(url, {
        method: 'POST',
        apiKey: provider.apiKey,
        body: {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: text }
          ],
          temperature: 0.8
        },
        timeoutMs: 60000
      })
      const out = json?.choices?.[0]?.message?.content
      if (!out || !String(out).trim()) throw new Error(m('main.err_optimize_no_content'))
      pushLog({ kind: 'optimize', ok: true, provider: provider.name, model, url, status: 200, durationMs: Date.now() - t0, message: m('main.log_optimize_ok') })
      return { prompt: String(out).trim() }
    } catch (err) {
      pushLog({ kind: 'optimize', ok: false, provider: provider.name, model, url, status: err.status, durationMs: Date.now() - t0, message: err.message, detail: err.responseText })
      throw err
    }
  })

  ipcMain.handle('video:generate', async (_e, payload = {}) => {
    const settings = await readSettings()
    const provider = activeProvider(settings)
    const baseUrl = normalizeBaseUrl(provider.baseUrl)
    const model = payload.model || provider.videoModel
    // OpenAI Videos APIs create tasks at POST /videos: 'openai-videos' (e.g. Agnes) and
    // 'openai-videos-strict' (e.g. Google Gemini, which rejects unknown top-level fields)
    const oaVideos = provider.videoApi === 'openai-videos'
    const oaStrict = provider.videoApi === 'openai-videos-strict'
    const path = normalizeBaseUrl(provider.videoPath) || (oaVideos || oaStrict ? '/videos' : '/videos/generations')
    const url = `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`
    const t0 = Date.now()
    try {
      if (!baseUrl) throw new Error(m('main.err_no_endpoint'))
      const prompt = String(payload.prompt || '').trim()
      // Image-to-video may omit the prompt ("just make the scene move"); plain text-to-video requires one
      if (!prompt && !payload.imageB64) throw new Error(m('main.err_enter_prompt'))
      if (!model) throw new Error(m('main.err_fill_video_model'))

      const body = { model, prompt: prompt || m('main.default_video_prompt') }
      const size = payload.size || provider.videoSize
      const seconds = payload.seconds || provider.videoSeconds
      if (oaStrict) {
        // Sora-compatible strict surface (Google Gemini): only model and prompt are valid at
        // top level — unknown top-level fields are rejected with 400 INVALID_ARGUMENT, so the
        // optional params go inside extra_body (duration_seconds as a number, aspect_ratio
        // derived from the pixel size; Veo supports only 16:9 / 9:16, no square option).
        const extra = {}
        const n = parseInt(seconds, 10)
        if (n) extra.duration_seconds = n
        const dim = String(size || '').match(/^(\d+)\s*[x×]\s*(\d+)$/i)
        if (dim) {
          const w = +dim[1]
          const h = +dim[2]
          if (w > h) extra.aspect_ratio = '16:9'
          else if (h > w) extra.aspect_ratio = '9:16'
        }
        if (Object.keys(extra).length) body.extra_body = extra
      } else if (oaVideos) {
        // OpenAI Videos spec: mode is required (text / keyframe / reference), seconds is a
        // string like "5", size is a resolution tier — pixel dimensions are rejected with 400.
        body.mode = payload.imageB64 ? 'keyframe' : 'text'
        const n = parseInt(seconds, 10)
        if (n) body.seconds = String(n)
        const tier = String(size || '').trim().toUpperCase()
        if (['720P', '1080P', '1K', '2K'].includes(tier)) body.size = tier
      } else {
        if (size) body.size = size
        if (seconds) {
          const n = parseInt(seconds, 10)
          if (n) {
            body.seconds = n
            body.duration = n // different proxies use different field names; sending both is safer
          }
        }
      }
      // Image-to-video: some models (e.g. grok-imagine-video-1.5) only support image-to-video and
      // reject plain text-to-video (Text-to-video is not supported). The image field type varies
      // per provider (string dataURL / {url} object / array / image_url); on 422 type errors,
      // retry with each variant in turn.
      let bodies = [body]
      if (payload.imageB64) {
        const dataUrl = `data:${mimeOf(payload.imageName || 'image.png')};base64,${payload.imageB64}`
        if (oaStrict) {
          // extra_body.image shape is undocumented on the compat layer; try a data-URL string
          // (if the shape is wrong, the provider's own error message is surfaced as-is)
          bodies = [{ ...body, extra_body: { ...(body.extra_body || {}), image: dataUrl } }]
        } else if (oaVideos) {
          // OpenAI Videos keyframe mode: the image becomes first_frame. Note Agnes requires a
          // publicly reachable URL for reference media — a data: URL may be rejected (the API
          // error message is surfaced as-is).
          bodies = [{ ...body, first_frame: dataUrl }]
        } else {
        // nexus (Rust serde) is known to report image: invalid type: string, expecting an object/array — try the object form first
        bodies = [
          { ...body, image: { url: dataUrl } },
          { ...body, image: [dataUrl] },
          { ...body, image: [{ url: dataUrl }] },
          { ...body, image_url: dataUrl },
          { ...body, image: dataUrl }
        ]
        }
      }
      let json = null
      let lastErr = null
      for (const b of bodies) {
        try {
          ;({ json } = await requestJson(url, {
            method: 'POST',
            apiKey: provider.apiKey,
            body: b,
            timeoutMs: 600000
          }))
          lastErr = null
          break
        } catch (err) {
          lastErr = err
          // only continue to the next variant for image-field deserialization/type issues; rethrow other errors
          const msg = String(err.message || '')
          const typeIssue = err.status === 422 || /deserialize|invalid type/i.test(msg)
          if (!typeIssue) throw err
        }
      }
      if (lastErr) throw lastErr

      let videos = pickMediaItems(json)
      if (!videos.length) {
        // OpenAI Videos create responses carry both id/task_id and video_id; only video_id is
        // valid for retrieval, so prefer it. Providers without video_id are unaffected.
        const jobId =
          json.video_id || json.id || json.task_id || json.request_id ||
          json?.data?.video_id || json?.data?.id || json?.data?.task_id
        if (!jobId) throw new Error(m('main.err_no_video_data'))
        videos = await pollVideoJob(baseUrl, provider, jobId)
      }
      if (!videos.length) throw new Error(m('main.err_no_video_url'))
      pushLog({ kind: 'video', ok: true, provider: provider.name, model, url, status: 200, durationMs: Date.now() - t0, message: m('main.log_video_ok', { count: videos.length }) })
      return { videos, model, prompt }
    } catch (err) {
      pushLog({ kind: 'video', ok: false, provider: provider.name, model, url, status: err.status, durationMs: Date.now() - t0, message: err.message, detail: err.responseText })
      // Common 400: the model only supports image-to-video (e.g. grok-imagine-video-1.5) —
  // surface an actionable message in the UI language
      if (/text-to-video is not supported/i.test(err.message || '')) {
        err.message = m('main.err_video_model_i2v', { model })
      }
      throw err
    }
  })

  ipcMain.handle('media:save', async (_e, payload = {}) => {
    const settings = await readSettings()
    const dir = settings.saveDir || defaultSaveDir()
    await fs.mkdir(dir, { recursive: true })
    const ext = payload.ext || defaultExt(payload.kind)
    const name = payload.filename || `rawphotos-${Date.now()}.${ext}`
    const filePath = join(dir, name)
    await fs.writeFile(filePath, await toBuffer(payload))
    return { path: filePath, dir }
  })

  ipcMain.handle('media:saveAs', async (_e, payload = {}) => {
    const isVideo = payload.kind === 'video'
    const ext = payload.ext || defaultExt(payload.kind)
    const filters = isVideo
      ? [
          { name: m('main.filter_mp4'), extensions: ['mp4'] },
          { name: m('main.filter_webm'), extensions: ['webm'] }
        ]
      : [
          { name: m('main.filter_png'), extensions: ['png'] },
          { name: m('main.filter_jpeg'), extensions: ['jpg', 'jpeg'] }
        ]
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: payload.defaultName || `rawphotos-${Date.now()}.${ext}`,
      filters
    })
    if (canceled || !filePath) return { canceled: true }
    await fs.writeFile(filePath, await toBuffer(payload))
    return { canceled: false, path: filePath }
  })

  ipcMain.handle('file:saveText', async (_e, payload = {}) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: payload.defaultName || `export-${Date.now()}.md`,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: m('main.filter_text'), extensions: ['txt'] }
      ]
    })
    if (canceled || !filePath) return { canceled: true }
    await fs.writeFile(filePath, String(payload.content || ''), 'utf-8')
    return { canceled: false, path: filePath }
  })

  ipcMain.handle('gallery:list', async () => {
    const settings = await readSettings()
    const dir = settings.saveDir || defaultSaveDir()
    try {
      const files = await fs.readdir(dir)
      const media = files.filter((f) => IMAGE_RE.test(f) || VIDEO_RE.test(f))
      const stated = await Promise.all(
        media.map(async (f) => {
          const full = join(dir, f)
          const st = await fs.stat(full)
          return {
            name: f,
            path: full,
            mtime: st.mtimeMs,
            size: st.size,
            kind: VIDEO_RE.test(f) ? 'video' : 'image'
          }
        })
      )
      stated.sort((a, b) => b.mtime - a.mtime)
      const top = stated.slice(0, 120)
      // Images are inlined as dataUrl for direct display; videos are large, so stream them
  // on demand over the rawmedia:// protocol.
      const items = await Promise.all(
        top.map(async (e) => {
          if (e.kind === 'image') {
            const buf = await fs.readFile(e.path)
            return { ...e, dataUrl: `data:${mimeOf(e.name)};base64,${buf.toString('base64')}` }
          }
          return e
        })
      )
      return { dir, items }
    } catch (err) {
      return { dir, items: [], error: err.message }
    }
  })

  ipcMain.handle('app:pickDir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled || !filePaths.length) return null
    return filePaths[0]
  })

  ipcMain.handle('app:openPath', async (_e, target) => {
    const dir = target || (await readSettings()).saveDir || defaultSaveDir()
    await fs.mkdir(dir, { recursive: true }).catch(() => {})
    await shell.openPath(dir)
    return dir
  })

  ipcMain.handle('app:defaultSaveDir', async () => defaultSaveDir())
  ipcMain.handle('app:version', async () => app.getVersion())
  ipcMain.handle('app:notify', async (_e, payload = {}) => {
    try {
      if (Notification.isSupported()) {
        new Notification({ title: payload.title || 'RawPhotos', body: payload.body || '', icon }).show()
      }
    } catch {
      // ignore notification failures
    }
    return true
  })

  ipcMain.handle('app:openExternal', async (_e, url) => {
    const u = String(url || '').trim()
    if (!/^https?:\/\//i.test(u)) throw new Error(m('main.err_only_http'))
    await shell.openExternal(u)
    return true
  })

  ipcMain.handle('logs:get', async () => logs)
  ipcMain.handle('logs:clear', async () => {
    logs.length = 0
    await fs.writeFile(logFile(), '', 'utf-8').catch(() => {})
    return true
  })
  ipcMain.handle('logs:openFile', async () => {
    const f = logFile()
    await fs.appendFile(f, '').catch(() => {})
    await shell.openPath(f)
    return f
  })

  // Query relay quota (one-api / new-api / OpenAI-style /dashboard/billing endpoints)
  ipcMain.handle('quota:get', async (_e, override) => {
    const settings = await readSettings()
    const provider = override && override.baseUrl ? override : activeProvider(settings)
    const baseUrl = normalizeBaseUrl(provider.baseUrl)
    if (!baseUrl) return { error: m('main.err_no_endpoint_short') }
    const headers = provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}
    let total = null
    let used = null
    let remaining = null
    let unit = 'USD'

    // 1) Generic /usage (many relays expose balance here: remaining / balance / quota.remaining)
    try {
      const r = await fetch(`${baseUrl}/usage`, { headers })
      if (r.ok) {
        const j = JSON.parse(await r.text())
        const rem = j?.remaining ?? j?.quota?.remaining ?? j?.balance
        if (typeof rem === 'number') remaining = rem
        if (typeof j?.total === 'number') total = j.total
        if (typeof j?.used === 'number') used = j.used
        if (j?.unit || j?.quota?.unit) unit = j.unit || j.quota.unit
      }
    } catch {
      // ignore
    }

    // 2) OpenAI / one-api billing endpoints
    if (remaining == null && total == null) {
      try {
        const r = await fetch(`${baseUrl}/dashboard/billing/subscription`, { headers })
        if (r.ok) {
          const j = JSON.parse(await r.text())
          total =
            typeof j.hard_limit_usd === 'number'
              ? j.hard_limit_usd
              : typeof j.system_hard_limit_usd === 'number'
                ? j.system_hard_limit_usd
                : null
        }
      } catch {
        // ignore
      }
      try {
        const end = new Date()
        const start = new Date()
        start.setDate(start.getDate() - 99)
        const fmt = (d) => d.toISOString().slice(0, 10)
        const r = await fetch(
          `${baseUrl}/dashboard/billing/usage?start_date=${fmt(start)}&end_date=${fmt(end)}`,
          { headers }
        )
        if (r.ok) {
          const j = JSON.parse(await r.text())
          if (typeof j.total_usage === 'number') used = j.total_usage / 100
        }
      } catch {
        // ignore
      }
    }

    // 3) credit_grants fallback
    if (total == null && used == null && remaining == null) {
      try {
        const r = await fetch(`${baseUrl}/dashboard/billing/credit_grants`, { headers })
        if (r.ok) {
          const j = JSON.parse(await r.text())
          if (typeof j.total_available === 'number') remaining = j.total_available
          if (typeof j.total_granted === 'number') total = j.total_granted
          if (typeof j.total_used === 'number') used = j.total_used
        }
      } catch {
        // ignore
      }
    }

    if (total == null && used == null && remaining == null) {
      return { error: m('main.err_no_quota') }
    }
    if (remaining == null && total != null && used != null) remaining = total - used
    const round = (v) => (v == null ? null : Math.round(v * 100) / 100)
    return { total: round(total), used: round(used), remaining: round(remaining), unit }
  })

  ipcMain.handle('chats:list', async () =>
    chats
      .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, count: (c.messages || []).length }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  )
  ipcMain.handle('chats:get', async (_e, id) => chats.find((c) => c.id === id) || null)
  ipcMain.handle('chats:save', async (_e, conv) => {
    if (!conv || !conv.id) return null
    const now = Date.now()
    const idx = chats.findIndex((c) => c.id === conv.id)
    const rec = {
      id: conv.id,
      title: conv.title || m('main.new_chat'),
      messages: Array.isArray(conv.messages) ? conv.messages : [],
      createdAt: idx >= 0 ? chats[idx].createdAt : now,
      updatedAt: now
    }
    if (idx >= 0) chats[idx] = rec
    else chats.unshift(rec)
    if (chats.length > CHATS_MAX) {
      chats = chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, CHATS_MAX)
    }
    await saveChatsFile()
    return { id: rec.id, createdAt: rec.createdAt, updatedAt: rec.updatedAt }
  })
  ipcMain.handle('chats:delete', async (_e, id) => {
    chats = chats.filter((c) => c.id !== id)
    await saveChatsFile()
    return true
  })

  ipcMain.handle('usage:get', async () => usage)
  ipcMain.handle('usage:reset', async () => {
    usage = freshUsage()
    await fs.writeFile(usageFile(), JSON.stringify(usage), 'utf-8').catch(() => {})
    return true
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 660,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0e1116',
    title: 'RawPhotos',
    icon,
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  const emitState = () =>
    mainWindow.webContents.send('window:state', { maximized: mainWindow.isMaximized() })
  mainWindow.on('maximize', emitState)
  mainWindow.on('unmaximize', emitState)

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[renderer did-fail-load]', code, desc, url)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', JSON.stringify(details))
  })
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error('[preload-error]', preloadPath, error?.message)
  })
  mainWindow.webContents.on('console-message', (...args) => {
    console.log('[renderer console]', ...args.slice(1))
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (process.env.RAWPHOTOS_SHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await mainWindow.webContents.capturePage()
          const out = join(app.getPath('temp'), 'rawphotos-shot.png')
          await fs.writeFile(out, img.toPNG())
          console.log('[shot] saved', out)
        } catch (e) {
          console.error('[shot]', e.message)
        }
      }, 2000)
    })
  }
}

  // Local video files are impractical to inline as base64 in the DOM; register a safe custom
  // protocol that streams them on demand and supports <video> range seeking.
  // Renderer usage: rawmedia://media/?p=<encodeURIComponent(absolute path)>
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'rawmedia',
    privileges: { secure: true, standard: true, stream: true, supportFetchAPI: true, bypassCSP: true }
  }
])

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// System tray menu — English by default (i18n not available in main process)
function createTray() {
  if (tray) return
  tray = new Tray(icon)
  tray.setToolTip('RawPhotos')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show RawPhotos', click: showMainWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}

app.whenReady().then(async () => {
  protocol.handle('rawmedia', (request) => {
    try {
      const p = new URL(request.url).searchParams.get('p')
      if (!p) return new Response('missing path', { status: 400 })
      return net.fetch(pathToFileURL(p).toString())
    } catch (err) {
      return new Response(String(err?.message || err), { status: 500 })
    }
  })

  await loadLogsFromFile()
  await loadUsage()
  await loadChats()
  registerIpc()
  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
