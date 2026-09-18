<script setup>
import { useI18n } from 'vue-i18n'
import { reactive, ref, computed, onMounted, watch } from 'vue'
import { store, persistSettings, setTheme, setCustomColor, applyTheme, THEMES } from '../store'
import { toast } from '../composables/useToast'
import Icon from './Icon.vue'
import Dropdown from './Dropdown.vue'

const { t } = useI18n()
const countOptions = computed(() =>
  [1, 2, 3, 4].map((n) => ({ value: n, label: `${n} ${t('settings.count_suffix')}` }))
)
const sizeOptions = [
  { value: '', label: t('settings.optional') },
  { value: '1024x1024', label: '1024 × 1024' },
  { value: '1536x1024', label: '1536 × 1024 (GPT)' },
  { value: '1024x1536', label: '1024 × 1536 (GPT)' },
  { value: 'auto', label: 'auto (GPT)' },
  { value: '1024x1792', label: '1024 × 1792 (DALL·E)' },
  { value: '1792x1024', label: '1792 × 1024 (DALL·E)' },
  { value: '768x768', label: '768 × 768' },
  { value: '512x512', label: '512 × 512' },
  { value: '1280x720', label: '1280 × 720' },
  { value: '720x1280', label: '720 × 1280' }
]

const PRESET_COLORS = ['#10b981', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#14b8a6']

function previewColor(e) {
  store.settings.customColor = e.target.value
  applyTheme('custom')
}
function commitColor() {
  setCustomColor(store.settings.customColor)
}
function pickPreset(c) {
  store.settings.customColor = c
  setCustomColor(c)
}

const currentTheme = computed(() => store.settings.theme || 'sky')
const providerModels = ref([])
const modelsLoading = ref(false)
const manual = reactive({ imageModel: false, videoModel: false, optimizeModel: false })

function blankProvider() {
  return {
    id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: t('settings.add_interface'),
    baseUrl: '',
    apiKey: '',
    imageModel: '',
    videoModel: '',
    optimizeModel: '',
    imageSize: '',
    videoSize: '',
    videoSeconds: '',
    editPath: '/images/edits',
    videoPath: '/videos/generations',
    videoPollPath: '',
    videoApi: ''
  }
}

const form = reactive({
  providers: [],
  activeProviderId: '',
  defaultCount: 1,
  saveDir: '',
  alertEnabled: false,
  alertThreshold: 5
})
const selectedId = ref('')
const showKey = ref(false)
const showAdvanced = ref(false)
const testing = ref(false)
const saving = ref(false)
const testResult = ref(null)

const selected = computed(() => form.providers.find((p) => p.id === selectedId.value) || null)

// Merge the currently selected value into the dropdown options (even when it is not in the
// /models list, e.g. a manually typed flux stays selectable and visible)
function optionsFor(current) {
  const list = providerModels.value
  if (current && !list.includes(current)) return [current, ...list]
  return list
}

const imageOptions = computed(() => [
  { value: '', label: t('settings.unselected') },
  ...optionsFor(selected.value?.imageModel)
])
const videoOptions = computed(() => [
  { value: '', label: t('settings.unselected') },
  ...optionsFor(selected.value?.videoModel)
])
const optimizeOptions = computed(() => [
  { value: '', label: t('settings.unselected') },
  ...optionsFor(selected.value?.optimizeModel)
])
// Video API style adapter: '' = legacy /videos/generations proxies, 'openai-videos' = OpenAI
// Videos-compatible APIs (POST /videos, mode/first_frame body, video_id retrieval, metadata.url)
const videoApiOptions = computed(() => [
  { value: '', label: t('settings.video_api_default') },
  { value: 'openai-videos', label: t('settings.video_api_openai') }
])

// Silently fetch the selected provider's model list on entry/switch to fill the dropdown.
// Failures stay silent (leave empty + allow manual input).
async function loadModels() {
  const p = selected.value
  providerModels.value = []
  if (!p || !p.baseUrl) return
  modelsLoading.value = true
  try {
    const res = await window.api.listModels({ baseUrl: p.baseUrl, apiKey: p.apiKey })
    providerModels.value = res.models || []
  } catch {
    providerModels.value = []
  } finally {
    modelsLoading.value = false
  }
}

function clone(v) {
  return JSON.parse(JSON.stringify(v))
}

function hydrate() {
  const s = store.settings
  form.providers = clone(s.providers || [])
  form.activeProviderId = s.activeProviderId || form.providers[0]?.id || ''
  form.defaultCount = s.defaultCount || 1
  form.saveDir = s.saveDir || ''
  form.alertEnabled = !!s.alertEnabled
  form.alertThreshold = s.alertThreshold ?? 5
  if (!form.providers.some((p) => p.id === selectedId.value)) {
    selectedId.value = form.activeProviderId || form.providers[0]?.id || ''
  }
}

onMounted(() => {
  hydrate()
  loadModels()
})

watch(selectedId, () => {
  manual.imageModel = false
  manual.videoModel = false
  manual.optimizeModel = false
  loadModels()
})

// Keep the video endpoint path consistent when the API style changes: switching to
// OpenAI Videos clears the legacy /videos/generations default (the main process then
// creates tasks at POST /videos); switching back restores it if the field was left empty.
watch(
  () => selected.value && selected.value.videoApi,
  (api, prev) => {
    const p = selected.value
    if (!p) return
    if (api === 'openai-videos' && p.videoPath === '/videos/generations') p.videoPath = ''
    if (prev === 'openai-videos' && !p.videoPath) p.videoPath = '/videos/generations'
  }
)

function cleanError(msg) {
  return String(msg || t('settings.operation_failed')).replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
}

function addProvider() {
  const p = blankProvider()
  form.providers.push(p)
  selectedId.value = p.id
  testResult.value = null
}

function removeProvider(id) {
  if (form.providers.length <= 1) {
    toast.error(t('settings.delete_confirm'))
    return
  }
  const idx = form.providers.findIndex((p) => p.id === id)
  if (idx === -1) return
  form.providers.splice(idx, 1)
  if (form.activeProviderId === id) form.activeProviderId = form.providers[0].id
  if (selectedId.value === id) selectedId.value = form.providers[0].id
  testResult.value = null
}

function selectProvider(id) {
  selectedId.value = id
  testResult.value = null
}

async function setActive(id) {
  form.activeProviderId = id
  // Persist immediately (including the current provider list); no need to click "Save settings"
  saving.value = true
  try {
    await persistSettings({
      providers: clone(form.providers),
      activeProviderId: id,
      defaultCount: form.defaultCount,
      saveDir: form.saveDir
    })
    hydrate()
    toast.success(t('settings.set_current'))
  } catch (err) {
    toast.error(t('settings.test_error') + ': ' + err.message)
  } finally {
    saving.value = false
  }
}

async function save() {
  for (const p of form.providers) {
    if (!String(p.name || '').trim()) p.name = t('settings.unnamed_interface')
  }
  saving.value = true
  try {
    await persistSettings({
      providers: clone(form.providers),
      activeProviderId: form.activeProviderId,
      defaultCount: form.defaultCount,
      saveDir: form.saveDir,
      alertEnabled: form.alertEnabled,
      alertThreshold: Number(form.alertThreshold) || 0
    })
    hydrate()
    toast.success(t('settings.settings_saved'))
  } catch (err) {
    toast.error(t('toast.save_failed') + ': ' + err.message)
  } finally {
    saving.value = false
  }
}

async function test() {
  if (!selected.value) return
  testing.value = true
  testResult.value = null
  try {
    const res = await window.api.testConnection({
      baseUrl: selected.value.baseUrl,
      apiKey: selected.value.apiKey
    })
    testResult.value = { ok: true, models: res.models || [], status: res.status }
    providerModels.value = res.models || []
    toast.success(t('settings.connection_success'))
  } catch (err) {
    testResult.value = { ok: false, message: cleanError(err.message) }
    toast.error(t('settings.connection_failed'))
  } finally {
    testing.value = false
  }
}

async function copyModel(m) {
  try {
    await navigator.clipboard.writeText(m)
    toast.success(t('toast.copied'))
  } catch {
    toast.error(t('toast.copy_failed'))
  }
}

async function pickDir() {
  const dir = await window.api.pickDir()
  if (dir) form.saveDir = dir
}

async function openDir() {
  const dir = await window.api.openPath(form.saveDir || '')
  toast.info(t('toast.opened') + ' ' + dir)
}
</script>

<template>
  <div class="view">
    <header class="view-head">
      <div class="head-title">
        <h1>{{ t('settings.title') }}</h1>
        <p class="sub">{{ t('settings.interface_config') }}</p>
      </div>
      <button class="btn btn-primary save-top" :disabled="saving" @click="save">
        <span v-if="saving" class="spin"></span>
        <Icon v-else name="check" :size="15" />
        <span>{{ t('settings.save') }}</span>
      </button>
    </header>

    <div class="scroll">
      <section class="card block">
        <div class="block-head">
          <Icon name="plug" :size="16" />
          <h2>{{ t('settings.interface_config') }}</h2>
          <button class="btn btn-sm add-btn" @click="addProvider">
            <Icon name="plus" :size="15" /><span>{{ t("settings.add_interface") }}</span>
          </button>
        </div>

        <div class="provider-list">
          <button
            v-for="p in form.providers"
            :key="p.id"
            class="provider-item"
            :class="{ selected: p.id === selectedId }"
            @click="selectProvider(p.id)"
          >
            <span
              class="pick-active"
              :class="{ on: p.id === form.activeProviderId }"
              :title="t('settings.set_current')"
              @click.stop="setActive(p.id)"
            >
              <Icon v-if="p.id === form.activeProviderId" name="check" :size="12" />
            </span>
            <span class="p-main">
              <span class="p-name">{{ p.name || t('settings.unnamed_interface') }}</span>
              <span class="p-url">{{ p.baseUrl || t('settings.not_configured') }}</span>
            </span>
            <span class="p-tags">
              <span v-if="p.imageModel" class="p-tag"><Icon name="image" :size="11" />{{ p.imageModel }}</span>
              <span v-if="p.videoModel" class="p-tag"><Icon name="film" :size="11" />{{ p.videoModel }}</span>
              <span v-if="p.id === form.activeProviderId" class="p-tag cur">{{ t('settings.current_interface') }}</span>
            </span>
          </button>
        </div>

        <div v-if="selected" class="editor">
          <div class="grid-2">
            <div class="field">
              <label>{{ t('settings.interface_name') }}</label>
              <input v-model="selected.name" class="input" :placeholder="t('settings.interface_placeholder')" spellcheck="false" />
            </div>
            <div class="field">
              <label>{{ t('settings.base_url') }} (/v1)</label>
              <input v-model="selected.baseUrl" class="input" placeholder="https://kiro.apimf.top/v1" spellcheck="false" />
            </div>
          </div>

          <div class="field">
            <label>API Key</label>
            <div class="key-row">
              <input
                v-model="selected.apiKey"
                :type="showKey ? 'text' : 'password'"
                class="input"
                :placeholder="t('settings.api_key') + ' (optional)'"
                spellcheck="false"
              />
              <button class="btn btn-ghost btn-icon" :title="showKey ? t('settings.hide_key') : t('settings.show_key')" @click="showKey = !showKey">
                <Icon :name="showKey ? 'eye-off' : 'eye'" :size="16" />
              </button>
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <label class="label-row">
                <span class="lbl"><Icon name="image" :size="13" /> {{ t('settings.image_model') }}</span>
                <button type="button" class="mini-link" @click="manual.imageModel = !manual.imageModel">
                  {{ manual.imageModel ? t('generate.list_select') : t('generate.manual') }}
                </button>
              </label>
              <input
                v-if="manual.imageModel"
                v-model="selected.imageModel"
                class="input"
                :placeholder="t('settings.model_placeholder')"
                spellcheck="false"
              />
              <Dropdown v-else v-model="selected.imageModel" :options="imageOptions" :placeholder="t('settings.unselected')" />
            </div>
            <div class="field">
              <label class="label-row">
                <span class="lbl"><Icon name="film" :size="13" /> {{ t('settings.video_model') }}</span>
                <button type="button" class="mini-link" @click="manual.videoModel = !manual.videoModel">
                  {{ manual.videoModel ? t('generate.list_select') : t('generate.manual') }}
                </button>
              </label>
              <input
                v-if="manual.videoModel"
                v-model="selected.videoModel"
                class="input"
                :placeholder="t('generate.manual') + '; ' + t('settings.optional')"
                spellcheck="false"
              />
              <Dropdown v-else v-model="selected.videoModel" :options="videoOptions" :placeholder="t('settings.unselected')" />
            </div>
          </div>

          <div class="field">
            <label class="label-row">
              <span class="lbl"><Icon name="sparkle" :size="13" /> {{ t('settings.optimize_model') }}</span>
              <button type="button" class="mini-link" @click="manual.optimizeModel = !manual.optimizeModel">
                {{ manual.optimizeModel ? t('generate.list_select') : t('generate.manual') }}
              </button>
            </label>
            <input
              v-if="manual.optimizeModel"
              v-model="selected.optimizeModel"
              class="input"
              :placeholder="t('settings.model_placeholder')"
              spellcheck="false"
            />
            <Dropdown v-else v-model="selected.optimizeModel" :options="optimizeOptions" :placeholder="t('settings.unselected')" />
            <span class="hint">
              <template v-if="modelsLoading">{{ t('settings.loading_models') }}</template>
              <template v-else-if="providerModels.length">{{ t('settings.models_loaded') }}</template>
              <template v-else>{{ t('settings.no_models') }}</template>
            </span>
          </div>

          <div class="grid-2">
            <div class="field">
              <label>{{ t('settings.image_size') }}</label>
              <Dropdown v-model="selected.imageSize" :options="sizeOptions" :placeholder="t('settings.optional')" />
            </div>
            <div class="field">
              <label>{{ t('settings.video_size_duration') }}</label>
              <div class="key-row">
                <input v-model="selected.videoSize" class="input" placeholder="1280x720" spellcheck="false" />
                <input v-model="selected.videoSeconds" class="input secs" :placeholder="t('generate.video_seconds')" spellcheck="false" />
              </div>
            </div>
          </div>

          <button class="adv-toggle" @click="showAdvanced = !showAdvanced">
            <Icon :name="showAdvanced ? 'eye-off' : 'eye'" :size="13" />
            <span>{{ showAdvanced ? t('settings.show_advanced') : t('settings.advanced_settings') }}</span>
          </button>
          <div v-if="showAdvanced" class="grid-2 adv">
            <div class="field">
              <label>{{ t('settings.edit_path') }}</label>
              <input v-model="selected.editPath" class="input" placeholder="/images/edits" spellcheck="false" />
              <span class="hint">{{ t('settings.image_hint') }} <code>/images/edits</code>, {{ t('settings.image_hint2') }}</span>
            </div>
            <div class="field">
              <label>{{ t('settings.video_path') }}</label>
              <input v-model="selected.videoPath" class="input" placeholder="/videos/generations" spellcheck="false" />
              <span class="hint">{{ t('settings.video_hint') }}</span>
            </div>
            <div class="field">
              <label>{{ t('settings.video_api') }}</label>
              <Dropdown v-model="selected.videoApi" :options="videoApiOptions" />
              <span class="hint">{{ t('settings.video_api_hint') }}</span>
            </div>
            <div class="field">
              <label>{{ t('settings.async_path') }}</label>
              <input v-model="selected.videoPollPath" class="input" placeholder="/videos/generations/{id}" spellcheck="false" />
              <span class="hint">{{ t('settings.async_hint') }} <code>{id}</code> {{ t('settings.async_hint2') }}</span>
            </div>
          </div>

          <div class="editor-actions">
            <button class="btn" :disabled="testing" @click="test">
              <span v-if="testing" class="spin"></span>
              <Icon v-else name="plug" :size="15" />
              <span>{{ t('settings.test_connection') }}</span>
            </button>
            <button
              class="btn"
              :disabled="selected.id === form.activeProviderId"
              @click="setActive(selected.id)"
            >
              <Icon name="check" :size="15" />
              <span>{{ selected.id === form.activeProviderId ? t('settings.current_interface') : t('settings.set_current') }}</span>
            </button>
            <button class="btn btn-danger-ghost" @click="removeProvider(selected.id)">
              <Icon name="trash" :size="15" />
              <span>{{ t('settings.delete') }}</span>
            </button>
            <Transition name="fade">
              <span v-if="testResult" class="test-result" :class="testResult.ok ? 'ok' : 'bad'">
                <Icon :name="testResult.ok ? 'check' : 'alert'" :size="14" />
                <template v-if="testResult.ok">
                  {{ t('settings.connection_success') }} (HTTP {{ testResult.status }})<template v-if="testResult.models.length">
                    · {{ testResult.models.length }} {{ t('settings.models_count') }}</template>
                </template>
                <template v-else>{{ testResult.message }}</template>
              </span>
            </Transition>
          </div>

          <div v-if="testResult?.ok && testResult.models.length" class="model-list">
            <span class="hint">{{ t('settings.copy_hint') }}</span>
            <div class="model-chips">
              <button
                v-for="m in testResult.models.slice(0, 60)"
                :key="m"
                class="chip"
                :title="t('settings.copy_model')"
                @click="copyModel(m)"
              >
                {{ m }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="card block">
        <div class="block-head">
          <Icon name="palette" :size="16" />
          <h2>{{ t('settings.greeting_theme') }}</h2>
        </div>
        <div class="theme-grid">
          <button
            v-for="theme in THEMES"
            :key="theme.id"
            class="theme-card"
            :class="{ active: currentTheme === theme.id }"
            @click="setTheme(theme.id)"
          >
            <span class="tc-preview" :style="{ background: theme.bg }">
              <span class="tc-bar" :style="{ background: theme.accent }"></span>
            </span>
            <span class="tc-label">{{ t(theme.label) }}</span>
            <Icon v-if="currentTheme === theme.id" name="check" :size="14" class="tc-check" />
          </button>

          <button class="theme-card" :class="{ active: currentTheme === 'custom' }" @click="setTheme('custom')">
            <span class="tc-preview" style="background: #f4f5f7">
              <span class="tc-bar" :style="{ background: store.settings.customColor || '#10b981' }"></span>
            </span>
            <span class="tc-label">{{ t('theme.custom') }}</span>
            <Icon v-if="currentTheme === 'custom'" name="check" :size="14" class="tc-check" />
          </button>
        </div>

        <div v-if="currentTheme === 'custom'" class="custom-color">
          <div class="cc-row">
            <span class="cc-label">{{ t('settings.theme_color') }}</span>
            <input
              type="color"
              class="color-input"
              :value="store.settings.customColor || '#10b981'"
              @input="previewColor"
              @change="commitColor"
            />
            <span class="cc-hex">{{ store.settings.customColor || '#10b981' }}</span>
          </div>
          <div class="cc-swatches">
            <button
              v-for="c in PRESET_COLORS"
              :key="c"
              class="cc-swatch"
              :style="{ background: c }"
              :title="c"
              @click="pickPreset(c)"
            ></button>
          </div>
        </div>
      </section>

      <section class="card block">
        <div class="block-head">
          <Icon name="settings" :size="16" />
          <h2>{{ t('settings.general') }}</h2>
        </div>
        <div class="grid-2">
          <div class="field">
            <label>{{ t('settings.default_count') }}</label>
            <Dropdown v-model="form.defaultCount" :options="countOptions" :placeholder="t('settings.select_count')" />
            <span class="hint">{{ t('settings.default_count_hint') }}</span>
          </div>
          <div class="field">
            <label>{{ t('settings.save_dir') }}</label>
            <div class="key-row">
              <input v-model="form.saveDir" class="input" :placeholder="t('settings.save_dir_hint')" spellcheck="false" />
              <button class="btn btn-ghost" @click="pickDir">{{ t('settings.choose') }}</button>
              <button class="btn btn-ghost btn-icon" :title="t('settings.open_dir')" @click="openDir">
                <Icon name="folder-open" :size="16" />
              </button>
            </div>
            <span class="hint">{{ t('settings.save_dir_used') }}</span>
          </div>
        </div>
      </section>

      <section class="card block">
        <div class="block-head">
          <Icon name="alert" :size="16" />
          <h2>{{ t('settings.quota_alert') }}</h2>
        </div>
        <label class="switch-row">
          <input type="checkbox" v-model="form.alertEnabled" />
          <span>{{ t('settings.enable_alert') }}</span>
        </label>
        <div v-if="form.alertEnabled" class="field">
          <label>{{ t('settings.alert_threshold') }} {{ t('settings.dollar') }}</label>
          <input v-model.number="form.alertThreshold" type="number" min="0" step="1" class="input thresh" />
          <span class="hint">{{ t('settings.alert_desc') }}{{ t('settings.alert_desc2') }}</span>
        </div>
      </section>

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
.save-top {
  height: 36px;
  min-width: 116px;
}
.scroll {
  flex: 1;
  overflow-y: auto;
  padding: 22px 40px 40px;
  width: 100%;
  max-width: 1500px;
  margin: 0 auto;
}
.block {
  padding: 18px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.block-head {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--accent);
}
.block-head h2 {
  margin: 0;
  font-size: 13.5px;
  font-weight: 650;
  color: var(--text);
}
.add-btn {
  margin-left: auto;
  color: var(--text);
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.provider-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 13px;
  border-radius: var(--radius-sm);
  background: var(--bg-1);
  border: 1px solid var(--border);
  text-align: left;
  transition: border-color 0.14s ease, background 0.14s ease;
}
.provider-item:hover {
  border-color: var(--border-2);
}
.provider-item.selected {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.pick-active {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1.5px solid var(--border-2);
  display: grid;
  place-items: center;
  color: #fff;
  transition: background 0.14s ease, border-color 0.14s ease;
}
.pick-active.on {
  background: var(--success);
  border-color: var(--success);
}
.p-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.p-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.p-url {
  font-size: 11.5px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.p-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.p-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  padding: 3px 8px;
  border-radius: 999px;
}
.p-tag.cur {
  color: var(--success);
  border-color: rgba(56, 199, 147, 0.4);
  background: rgba(56, 199, 147, 0.1);
}

.editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.field > label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-2);
  font-weight: 550;
}
.label-row {
  display: flex !important;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.lbl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.mini-link {
  font-size: 11.5px;
  font-weight: 550;
  color: var(--accent);
  padding: 2px 4px;
  border-radius: 5px;
}
.mini-link:hover {
  background: var(--accent-soft);
}
.key-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.key-row .input {
  flex: 1;
}
.secs {
  max-width: 76px;
  flex: 0 0 auto;
}
.adv-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  align-self: flex-start;
  font-size: 12px;
  color: var(--text-3);
  padding: 4px 0;
}
.adv-toggle:hover {
  color: var(--text);
}
.adv {
  padding: 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-1);
  border: 1px solid var(--border);
}
.editor-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.btn-danger-ghost {
  color: var(--danger);
}
.btn-danger-ghost:hover {
  background: rgba(240, 82, 106, 0.1);
  border-color: rgba(240, 82, 106, 0.4);
}
.test-result {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 550;
}
.test-result.ok {
  color: var(--success);
}
.test-result.bad {
  color: var(--danger);
}
.model-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
code {
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 12px;
  /* The old fixed #8ab4ff was unreadable on white in light themes; now follows the theme accent color */
  color: var(--accent);
  font-family: 'Cascadia Code', Consolas, monospace;
}
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}
.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-1);
  border: 1px solid var(--border);
  text-align: left;
  transition: border-color 0.14s ease, transform 0.1s ease;
}
.theme-card:hover {
  border-color: var(--border-2);
  transform: translateY(-2px);
}
.theme-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.tc-preview {
  height: 46px;
  border-radius: 7px;
  border: 1px solid var(--border);
  display: flex;
  align-items: flex-end;
  padding: 7px;
}
.tc-bar {
  width: 60%;
  height: 8px;
  border-radius: 999px;
}
.tc-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}
.tc-check {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--accent);
}
.custom-color {
  margin-top: 14px;
  padding: 14px;
  border-radius: var(--radius-sm);
  background: var(--bg-1);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cc-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.cc-label {
  font-size: 12.5px;
  color: var(--text-2);
  font-weight: 550;
}
.color-input {
  width: 46px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--border-2);
  border-radius: 7px;
  background: none;
  cursor: pointer;
}
.color-input::-webkit-color-swatch-wrapper {
  padding: 3px;
}
.color-input::-webkit-color-swatch {
  border: none;
  border-radius: 4px;
}
.cc-hex {
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 12.5px;
  color: var(--text-2);
  text-transform: uppercase;
}
.cc-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cc-swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--surface);
  box-shadow: 0 0 0 1px var(--border-2);
  transition: transform 0.12s ease;
}
.cc-swatch:hover {
  transform: scale(1.12);
}
.hint {
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.55;
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  color: var(--text-2);
  cursor: pointer;
}
.switch-row input {
  accent-color: var(--accent);
  width: 16px;
  height: 16px;
}
.thresh {
  max-width: 160px;
}
/* Bottom save bar removed; saving is unified via the top-right "Save settings" button */
</style>
