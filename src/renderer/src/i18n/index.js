import { createI18n } from 'vue-i18n'
import en from './languages/en.json'
import zh from './languages/zh.json'
import ar from './languages/ar.json'

// Available languages
export const SUPPORTED_LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ar', name: 'Arabic' }
]

// Right-to-left locales set the document dir attribute
export const RTL_LOCALES = ['ar']

// Load messages for a specific locale
const messages = { en, zh, ar }

// Get initial language from localStorage or default to English
function getInitialLocale() {
  try {
    const saved = localStorage.getItem('rawphotos-language')
    if (saved && SUPPORTED_LOCALES.some((l) => l.code === saved)) {
      return saved
    }
  } catch {
    // localStorage not available
  }
  return 'en' // English is the international default
}

// Create the i18n instance
const i18n = createI18n({
  legacy: false,
  locale: getInitialLocale(),
  fallbackLocale: 'en',
  messages,
  silentTranslationWarn: true,
  silentFailed: true
})

// Sync the document lang/dir attributes with the active locale so RTL
// languages (Arabic) mirror the layout without touching component CSS
export function applyDocumentLang(locale) {
  const el = document.documentElement
  el.lang = locale
  el.dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr'
}

// Apply direction for the initial locale before the first render
applyDocumentLang(i18n.global.locale.value)

// Change language, sync the document direction and persist to localStorage
export async function changeLanguage(lang) {
  if (!SUPPORTED_LOCALES.some((l) => l.code === lang)) return
  i18n.global.locale.value = lang
  applyDocumentLang(lang)
  try {
    localStorage.setItem('rawphotos-language', lang)
  } catch {
    // localStorage not available, ignore
  }
}

export default i18n
