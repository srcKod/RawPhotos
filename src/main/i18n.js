// Main-process i18n — shares the renderer locale catalogs (en.json / zh.json) via
// @intlify/core-base, the framework-agnostic core of vue-i18n. Keeping all
// user-facing strings in the JSON catalogs means adding a third language only
// requires a new file (plus its name in SUPPORTED_LOCALES), never code edits.
//
// NOTE: unlike vue-i18n, @intlify/core-base is dependency-injection based — it
// does NOT auto-register a message compiler / resolver / locale fallbacker.
// Without the three registrations below, translate() cannot compile any message
// and silently returns the raw key (e.g. "main.err_http_status") instead of the
// translated string.
import {
  createCoreContext,
  translate,
  compileToFunction,
  resolveValue,
  fallbackWithLocaleChain
} from '@intlify/core-base'
import en from '../renderer/src/i18n/languages/en.json'
import zh from '../renderer/src/i18n/languages/zh.json'

const ctx = createCoreContext({
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en, zh },
  messageCompiler: compileToFunction,
  messageResolver: resolveValue,
  localeFallbacker: fallbackWithLocaleChain
})

export function setLocale(lang) {
  if (lang === 'en' || lang === 'zh') ctx.locale = lang
}

// Translate a key ({param} named interpolation supported). Returns the key itself
// when missing so wiring mistakes are visible instead of silent empties.
export function m(key, params) {
  return params ? translate(ctx, key, params) : translate(ctx, key)
}
