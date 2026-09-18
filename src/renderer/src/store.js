import { reactive } from 'vue'
import { changeLanguage as i18nChangeLanguage } from './i18n'

// THEMES: labels will be translated via i18n keys
export const THEMES = [
  { id: 'green', label: 'theme.green', bg: '#f2f7f4', accent: '#0d9488' },
  { id: 'sky', label: 'theme.sky', bg: '#eef4fb', accent: '#0ea5e9' },
  { id: 'dark', label: 'theme.dark', bg: '#0e1116', accent: '#6ea8fe' }
]

const THEME_IDS = new Set([...THEMES.map((t) => t.id), 'custom'])
const ACCENT_VARS = ['--accent', '--accent-hover', '--accent-soft', '--accent-line', '--ring', '--accent-glow', '--on-accent']

export const store = reactive({
  settings: {
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
    alertThreshold: 5,
    language: 'en'
  },
  settingsLoaded: false,
  // Results generated this session: { id, kind:'image'|'video', b64, url, prompt, revisedPrompt, model, time, saved }
  results: []
})

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const int = parseInt(n, 16)
  if (Number.isNaN(int) || n.length !== 6) return { r: 16, g: 185, b: 129 }
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}
function darkenHex(hex, factor = 0.84) {
  const { r, g, b } = hexToRgb(hex)
  const d = (v) => Math.max(0, Math.min(255, Math.round(v * factor)))
  return `#${[d(r), d(g), d(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export function applyTheme(theme) {
  const t = THEME_IDS.has(theme) ? theme : 'sky'
  const el = document.documentElement
  el.dataset.theme = t
  if (t === 'custom') {
    const c = store.settings.customColor || '#10b981'
    const { r, g, b } = hexToRgb(c)
    el.style.setProperty('--accent', c)
    el.style.setProperty('--accent-hover', darkenHex(c))
    el.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.12)`)
    el.style.setProperty('--accent-line', `rgba(${r}, ${g}, ${b}, 0.5)`)
    el.style.setProperty('--ring', `rgba(${r}, ${g}, ${b}, 0.4)`)
    el.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.28)`)
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    el.style.setProperty('--on-accent', luma > 165 ? '#15181f' : '#ffffff')
  } else {
    ACCENT_VARS.forEach((v) => el.style.removeProperty(v))
  }
  try {
    localStorage.setItem('rawphotos-theme', t)
  } catch {
    // ignore: localStorage unavailability does not affect theme application
  }
}

export async function setCustomColor(color) {
  store.settings.customColor = color
  applyTheme('custom')
  return persistSettings({ theme: 'custom', customColor: color })
}

export async function loadSettings() {
  store.settings = await window.api.getSettings()
  store.settingsLoaded = true
  applyTheme(store.settings.theme)
  // Sync i18n locale with saved language setting
  if (store.settings.language) {
    await i18nChangeLanguage(store.settings.language)
  }
  return store.settings
}

export async function persistSettings(patch) {
  store.settings = await window.api.saveSettings(patch)
  return store.settings
}

export async function setTheme(theme) {
  applyTheme(theme)
  return persistSettings({ theme })
}

function getInitialLanguage() {
  try {
    const saved = localStorage.getItem('rawphotos-language')
    if (saved) return saved
  } catch {
    // localStorage not available
  }
  return 'en' // Default to English
}

// Language helper functions
export async function setLanguage(lang) {
  const { changeLanguage } = await import('./i18n')
  await changeLanguage(lang)
  store.settings.language = lang
  return persistSettings({ language: lang })
}

export function getCurrentLanguage() {
  return store.settings.language || 'en'
}

export function activeProvider() {
  const list = store.settings.providers || []
  return list.find((p) => p.id === store.settings.activeProviderId) || list[0] || null
}

export async function setActiveProvider(id) {
  if (id === store.settings.activeProviderId) return store.settings
  return persistSettings({ activeProviderId: id })
}

export function addResults(items) {
  store.results.unshift(...items)
}

export function clearResults() {
  store.results.splice(0, store.results.length)
}

export function isConfigured() {
  const p = activeProvider()
  return Boolean(p && p.baseUrl)
}
