import { createI18n } from 'vue-i18n'
import en from './languages/en.json'
import zh from './languages/zh.json'

// Available languages
export const SUPPORTED_LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'zh', name: 'Chinese' }
]

// Load messages for a specific locale
const messages = { en, zh }

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

// Change language and persist to localStorage
export async function changeLanguage(lang) {
  if (!SUPPORTED_LOCALES.some((l) => l.code === lang)) return
  i18n.global.locale.value = lang
  try {
    localStorage.setItem('rawphotos-language', lang)
  } catch {
    // localStorage not available, ignore
  }
}

export default i18n
