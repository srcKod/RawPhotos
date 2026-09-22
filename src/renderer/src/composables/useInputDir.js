import { ref, watch } from 'vue'

// RTL Unicode ranges: Arabic, Hebrew, and related scripts
const RTL_CHARS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
// Latin + CJK (LTR scripts that matter for mixed-content detection)
const LTR_CHARS = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u2E80-\u9FFF\uAC00-\uD7AF]/

/**
 * Auto-detect text direction from content.
 * Returns a ref ('rtl' | 'ltr') that updates whenever the source text changes.
 * The textarea should bind `:dir="inputDir"` — the browser places the cursor
 * and flows text accordingly (RTL → right side, LTR → left side).
 *
 * @param {import('vue').Ref<string>|import('vue').ComputedRef<string>} textRef
 * @returns {import('vue').Ref<string>} dir ref ('rtl' or 'ltr')
 */
export function useInputDir(textRef) {
  const dir = ref('ltr')

  watch(
    textRef,
    (val) => {
      const s = String(val || '')
      const rtlCount = (s.match(new RegExp(RTL_CHARS.source, 'g')) || []).length
      const ltrCount = (s.match(new RegExp(LTR_CHARS.source, 'g')) || []).length
      dir.value = rtlCount > ltrCount ? 'rtl' : 'ltr'
    },
    { immediate: true }
  )

  return dir
}
