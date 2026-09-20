<script setup>
import { onMounted, onUnmounted, watch, ref, computed } from 'vue'
import { store, loadSettings, persistSettings, isConfigured, activeProvider, setTheme, THEMES } from './store'
import { useI18n } from 'vue-i18n'
import { SUPPORTED_LOCALES, changeLanguage as i18nChangeLanguage } from './i18n'
import { toast } from './composables/useToast'
import TitleBar from './components/TitleBar.vue'
import Icon from './components/Icon.vue'
import GenerateView from './components/GenerateView.vue'
import ChatView from './components/ChatView.vue'
import GalleryView from './components/GalleryView.vue'
import SettingsView from './components/SettingsView.vue'
import LogsView from './components/LogsView.vue'
import StatsView from './components/StatsView.vue'
import AboutView from './components/AboutView.vue'
import ToastHost from './components/ToastHost.vue'

const { t } = useI18n()
const view = ref('generate')
const showLangDropdown = ref(false)

// Available languages from i18n config
const availableLanguages = SUPPORTED_LOCALES

const navItems = computed(() => [
  { id: 'generate', label: t('nav.generate'), icon: 'sparkle' },
  { id: 'chat', label: t('nav.chat'), icon: 'chat' },
  { id: 'gallery', label: t('nav.gallery'), icon: 'grid' },
  { id: 'stats', label: t('nav.stats'), icon: 'chart' },
  { id: 'logs', label: t('nav.logs'), icon: 'logs' },
  { id: 'settings', label: t('nav.settings'), icon: 'settings' },
  { id: 'about', label: t('nav.about'), icon: 'info' }
])

const configured = computed(() => isConfigured())
const prov = computed(() => activeProvider())
const currentTheme = computed(() => store.settings.theme || 'sky')
const currentLang = computed(() => store.settings.language || 'en')

const langLabel = computed(() => {
  const found = availableLanguages.find(l => l.code === currentLang.value)
  return found ? found.name : 'English'
})

const quit = () => window.api.quitApp()
const hideToTray = () => window.api.window.close()

async function changeLanguage(lang) {
  await i18nChangeLanguage(lang)
  store.settings.language = lang
  await persistSettings({ language: lang })
}

function selectLanguage(lang) {
  changeLanguage(lang)
  showLangDropdown.value = false
}

const balance = ref(null)
function money(v) {
  if (v == null) return '—'
  const u = balance.value?.unit || 'USD'
  return u === 'USD' ? `$${Number(v).toFixed(2)}` : `${Number(v).toFixed(2)} ${u}`
}
let belowAlerted = false
function checkAlert() {
  const s = store.settings
  const rem = balance.value?.remaining
  if (!s.alertEnabled || rem == null) {
    belowAlerted = false
    return
  }
  const th = Number(s.alertThreshold) || 0
  if (rem <= th) {
    if (!belowAlerted) {
      belowAlerted = true
      const msg = t('toast.lowQuota') + ': ' + t('quota.remaining') + ' ' + money(rem) + ', ' + t('toast.thresholdBelow') + ' ' + money(th)
      toast.error(msg)
      window.api.notify({ title: t('toast.lowQuotaTitle'), body: msg })
    }
  } else {
    belowAlerted = false
  }
}

async function loadBalance() {
  if (!isConfigured()) {
    balance.value = null
    return
  }
  try {
    const q = await window.api.getQuota()
    balance.value = q && q.error ? null : q
    checkAlert()
  } catch {
    balance.value = null
  }
}
let balTimer = null
watch(() => store.settings.activeProviderId, () => loadBalance())

const closeDialog = ref(false)
const rememberClose = ref(false)

function onCloseRequest() {
  const mode = store.settings.closeAction || 'ask'
  if (mode === 'tray') return hideToTray()
  if (mode === 'quit') return quit()
  rememberClose.value = false
  closeDialog.value = true
}

async function chooseClose(action) {
  if (rememberClose.value) await persistSettings({ closeAction: action })
  closeDialog.value = false
  if (action === 'tray') hideToTray()
  else quit()
}

onMounted(async () => {
  await loadSettings()
  if (!isConfigured()) view.value = 'settings'
  loadBalance()
  balTimer = setInterval(loadBalance, 60000)

  document.addEventListener('click', () => {
    showLangDropdown.value = false
  })
})
onUnmounted(() => {
  if (balTimer) clearInterval(balTimer)
})
</script>

<template>
  <div class="app">
    <TitleBar @close-request="onCloseRequest" />

    <div class="body">
      <aside class="sidebar">
        <nav class="nav">
          <button
            v-for="item in navItems"
            :key="item.id"
            class="nav-item"
            :class="{ active: view === item.id }"
            @click="view = item.id"
          >
            <Icon :name="item.icon" :size="18" />
            <span>{{ item.label }}</span>
            <span v-if="item.id === 'settings' && !configured" class="nav-dot"></span>
          </button>
        </nav>

        <div class="lang-row">
          <button class="lang-btn" :title="t('settings.language')" @click.stop="showLangDropdown = !showLangDropdown">
            <Icon name="globe" :size="16" />
            <span class="lang-current">{{ langLabel }}</span>
            <Icon name="chevron" :size="10" class="lang-chev" :class="{ open: showLangDropdown }" />
          </button>
          <Transition name="fade">
            <div v-if="showLangDropdown" class="lang-dropdown" @click.stop>
              <button
                v-for="lang in availableLanguages"
                :key="lang.code"
                class="lang-option"
                :class="{ active: currentLang === lang.code }"
                @click="selectLanguage(lang.code)"
              >
                {{ lang.name }}
                <Icon v-if="currentLang === lang.code" name="check" :size="13" />
              </button>
            </div>
          </Transition>
        </div>

        <div class="sidebar-foot">
          <div v-if="balance" class="balance" :title="t('quota.remaining')" >
            <span class="bal-ic"><Icon name="plug" :size="13" /></span>
            <div class="bal-text">
              <div class="bal-num">{{ money(balance.remaining) }}</div>
              <div class="bal-sub">
                {{ t('quota.remaining') }}<template v-if="balance.total != null"> / {{ t('quota.total') }} {{ money(balance.total) }}</template>
              </div>
            </div>
          </div>

          <div class="theme-row">
            <button
              v-for="theme in THEMES"
              :key="theme.id"
              class="theme-dot"
              :class="{ active: currentTheme === theme.id }"
              :style="{ background: theme.bg }"
              :title="t(theme.label)"
              @click="setTheme(theme.id)"
            >
              <span class="theme-accent" :style="{ background: theme.accent }"></span>
            </button>
            <button
              class="theme-dot"
              :class="{ active: currentTheme === 'custom' }"
              style="background: #f4f5f7"
              :title="t('theme.custom')"
              @click="setTheme('custom')"
            >
              <span class="theme-accent" :style="{ background: store.settings.customColor || '#10b981' }"></span>
            </button>
          </div>

          <div class="status-card">
            <span class="dot" :class="{ on: configured }"></span>
            <div class="status-text">
              <div class="status-title">{{ configured ? (prov?.name || t('status.connected')) : t('status.not_configured') }}</div>
              <div class="status-sub">{{ prov?.imageModel || t('status.no_model') }}</div>
            </div>
          </div>
        </div>
      </aside>

      <main class="content">
        <template v-if="store.settingsLoaded">
          <GenerateView v-show="view === 'generate'" @go-settings="view = 'settings'" />
          <ChatView v-if="view === 'chat'" />
          <GalleryView v-if="view === 'gallery'" />
          <StatsView v-if="view === 'stats'" />
          <LogsView v-if="view === 'logs'" />
          <SettingsView v-if="view === 'settings'" />
          <AboutView v-if="view === 'about'" />
        </template>
      </main>
    </div>

    <Transition name="fade">
      <div v-if="closeDialog" class="modal-mask" @click.self="closeDialog = false">
        <div class="modal">
          <button class="modal-x" :title="t('modal.close')" @click="closeDialog = false">
            <Icon name="win-close" :size="13" />
          </button>
          <h3 class="modal-title">{{ t('modal.close_title') }}</h3>
          <p class="modal-desc">{{ t('modal.close_desc') }}</p>

          <div class="modal-choices">
            <button class="choice" @click="chooseClose('tray')">
              <span class="choice-ic tray"><Icon name="tray" :size="18" /></span>
              <span class="choice-txt">
                <b>{{ t('modal.minimize_to_tray') }}</b>
                <small>{{ t('modal.minimize_desc') }}</small>
              </span>
              <Icon name="chevron" :size="15" class="choice-arrow" />
            </button>
            <button class="choice" @click="chooseClose('quit')">
              <span class="choice-ic quit"><Icon name="power" :size="18" /></span>
              <span class="choice-txt">
                <b>{{ t('modal.quit_app') }}</b>
                <small>{{ t('modal.quit_desc') }}</small>
              </span>
              <Icon name="chevron" :size="15" class="choice-arrow" />
            </button>
          </div>

          <label class="modal-remember">
            <input type="checkbox" v-model="rememberClose" />
            <span>{{ t('modal.remember_choice') }}</span>
          </label>
        </div>
      </div>
    </Transition>

    <ToastHost />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
.body {
  flex: 1;
  display: grid;
  grid-template-columns: 216px 1fr;
  min-height: 0;
}

.sidebar {
  display: flex;
  flex-direction: column;
  padding: 14px 12px;
  background: var(--bg-1);
  border-right: 1px solid var(--border);
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-size: 13.5px;
  font-weight: 550;
  position: relative;
  transition: background 0.14s ease, color 0.14s ease;
}
.nav-item:hover {
  background: var(--surface);
  color: var(--text);
}
.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.nav-dot {
  margin-left: auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--warn);
  box-shadow: 0 0 0 3px rgba(245, 166, 35, 0.16);
}

.lang-row {
  position: relative;
  padding: 10px 12px 14px;
}
.lang-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 11px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.lang-btn:hover {
  background: var(--surface);
  border-color: var(--border);
  color: var(--text);
}
.lang-current {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lang-chev {
  flex-shrink: 0;
  color: var(--text-3);
  transition: transform 0.16s ease, color 0.16s ease;
}
.lang-chev.open {
  transform: rotate(-90deg);
  color: var(--accent);
}
.lang-dropdown {
  position: absolute;
  top: calc(100% - 6px);
  left: 12px;
  right: 12px;
  z-index: 60;
  padding: 5px;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
}
.lang-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease, color 0.12s ease;
}
.lang-option:hover {
  background: var(--surface-2);
  color: var(--text);
}
.lang-option.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.sidebar-foot {
  margin-top: auto;
}
.balance {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  margin-bottom: 10px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
}
.bal-ic {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: var(--on-accent, #fff);
  background: var(--accent);
}
.bal-text {
  min-width: 0;
}
.bal-num {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.bal-sub {
  font-size: 10.5px;
  color: var(--text-3);
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.theme-row {
  display: flex;
  gap: 8px;
  justify-content: center;
  padding: 6px 0 12px;
}
.theme-dot {
  position: relative;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1.5px solid var(--border-2);
  display: grid;
  place-items: center;
  transition: transform 0.12s ease, border-color 0.14s ease;
}
.theme-dot:hover {
  transform: translateY(-2px);
}
.theme-dot.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.theme-accent {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.status-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 11px;
  border-radius: var(--radius-sm);
  background: var(--surface);
  border: 1px solid var(--border);
}
.status-card .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-3);
  flex-shrink: 0;
}
.status-card .dot.on {
  background: var(--success);
  box-shadow: 0 0 0 3px rgba(56, 199, 147, 0.16);
}
.status-text {
  min-width: 0;
}
.status-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}
.status-sub {
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(5, 8, 7, 0.55);
  display: grid;
  place-items: center;
  backdrop-filter: blur(4px);
}
.modal {
  position: relative;
  width: 360px;
  max-width: calc(100vw - 48px);
  padding: 22px;
  border-radius: var(--radius-lg);
  background: var(--surface);
  border: 1px solid var(--border-2);
  box-shadow: var(--shadow);
}
.modal-x {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  color: var(--text-3);
}
.modal-x:hover {
  background: var(--surface-2);
  color: var(--text);
}
.modal-title {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 700;
}
.modal-desc {
  margin: 0 0 16px;
  font-size: 12.5px;
  color: var(--text-3);
}
.modal-choices {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.choice {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 13px;
  border-radius: var(--radius);
  background: var(--bg-1);
  border: 1px solid var(--border);
  text-align: left;
  transition: border-color 0.14s ease, background 0.14s ease, transform 0.06s ease;
}
.choice:hover {
  border-color: var(--accent-line);
  background: var(--surface-2);
}
.choice:active {
  transform: translateY(1px);
}
.choice-ic {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: 11px;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: var(--accent-soft);
}
.choice-ic.quit {
  color: var(--danger);
  background: rgba(225, 29, 72, 0.1);
}
.choice-txt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.choice-txt b {
  font-size: 13.5px;
  font-weight: 600;
}
.choice-txt small {
  font-size: 11.5px;
  color: var(--text-3);
}
.choice-arrow {
  color: var(--text-3);
  flex-shrink: 0;
}
.modal-remember {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-3);
  margin-top: 16px;
  cursor: pointer;
}
.modal-remember input {
  accent-color: var(--accent);
}

.content {
  overflow: hidden;
  min-width: 0;
}
</style>
