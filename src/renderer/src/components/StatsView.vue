<script setup>
import { useI18n } from 'vue-i18n'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { activeProvider } from '../store'
import { toast } from '../composables/useToast'
import Icon from './Icon.vue'

const { t } = useI18n()
const usage = ref(null)
const loading = ref(false)

const quota = ref(null)
const quotaErr = ref('')
const quotaLoading = ref(false)

const provider = computed(() => activeProvider())

// visual filters: which metric drives the charts below
const sumFilter = ref('requests') // 'requests' | 'tokens' — toggled from the totals bar
const tokFilter = ref('total') // 'total' | 'in' | 'out' — toggled from the token cards

const KIND_CARDS = [
  { key: 'image', label: t('stats.images'), icon: 'image' },
  { key: 'video', label: t('stats.videos'), icon: 'film' },
  { key: 'optimize', label: t('stats.optimize'), icon: 'sparkle' },
  { key: 'chat', label: t('nav.chat'), icon: 'chat' }
]

function kindCount(k) {
  return usage.value?.byKind?.[k] || 0
}

const totalReq = computed(() => (usage.value ? (usage.value.ok || 0) + (usage.value.fail || 0) : 0))
const okRate = computed(() => (totalReq.value ? Math.round(((usage.value.ok || 0) / totalReq.value) * 100) : 0))
const genTotal = computed(() => KIND_CARDS.reduce((s, c) => s + kindCount(c.key), 0))

const usedPct = computed(() => {
  const q = quota.value
  if (!q || q.total == null || !q.total || q.used == null) return null
  return Math.min(100, Math.max(0, Math.round((q.used / q.total) * 100)))
})

const days = computed(() => {
  const arr = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    arr.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}`, n: usage.value?.byDay?.[key] || 0 })
  }
  return arr
})
function dayTokens(key) {
  const td = usage.value?.tokensByDay?.[key]
  return td ? (td.in || 0) + (td.out || 0) : 0
}

// chartDays switches the 7-day chart between request counts and token totals
const chartDays = computed(() =>
  sumFilter.value === 'tokens' ? days.value.map((d) => ({ ...d, n: dayTokens(d.key) })) : days.value
)
const maxDay = computed(() => Math.max(1, ...chartDays.value.map((d) => d.n)))

const topModels = computed(() =>
  Object.entries(usage.value?.byModel || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
)

// topList switches the models ranking between requests and tokens
const topList = computed(() => {
  if (sumFilter.value === 'tokens') {
    return Object.entries(usage.value?.tokensByModel || {})
      .map(([model, t]) => [model, (t.in || 0) + (t.out || 0)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
  }
  return topModels.value
})
const maxModel = computed(() => Math.max(1, ...topList.value.map((m) => m[1])))

const tokens = computed(() => usage.value?.tokens || { in: 0, out: 0 })
const hasTokens = computed(() => (tokens.value.in || 0) + (tokens.value.out || 0) > 0)

// last 7 days of token in/out, reusing the same day keys as the request chart
const tDays = computed(() =>
  days.value.map((d) => ({ ...d, tok: usage.value?.tokensByDay?.[d.key] || null }))
)

// tokFilter: which token slice the token card's chart and per-model list show
function tokVal(td) {
  if (!td) return 0
  if (tokFilter.value === 'in') return td.in || 0
  if (tokFilter.value === 'out') return td.out || 0
  return (td.in || 0) + (td.out || 0)
}
const maxTokDay = computed(() => Math.max(1, ...tDays.value.map((d) => tokVal(d.tok))))

const topTokModels = computed(() =>
  Object.entries(usage.value?.tokensByModel || {})
    .map(([model, t]) => ({ model, in: t.in || 0, out: t.out || 0 }))
    .map((m) => ({ ...m, v: tokVal(m) }))
    .filter((m) => m.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 8)
)
const maxTokModel = computed(() => Math.max(1, ...topTokModels.value.map((m) => m.v)))

function fmtNum(x) {
  return (x ?? 0).toLocaleString('en-US')
}

// compact number for token bar labels (12.3k / 4.5M)
function fmtCompact(x) {
  const v = x || 0
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k'
  return String(v)
}

function cleanErr(m) {
  return String(m || '').replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
}
function money(v) {
  if (v == null) return '—'
  const u = quota.value?.unit || 'USD'
  return u === 'USD' ? `$${Number(v).toFixed(2)}` : `${Number(v).toFixed(2)} ${u}`
}

async function refresh() {
  loading.value = true
  try {
    usage.value = await window.api.getUsage()
  } catch (err) {
    toast.error(t('stats.read_failed') + ': ' + err.message)
  } finally {
    loading.value = false
  }
}

async function loadQuota() {
  quotaLoading.value = true
  quotaErr.value = ''
  try {
    const q = await window.api.getQuota()
    if (q && q.error) {
      quota.value = null
      quotaErr.value = q.error
    } else {
      quota.value = q
    }
  } catch (err) {
    quota.value = null
    quotaErr.value = cleanErr(err.message)
  } finally {
    quotaLoading.value = false
  }
}

function refreshAll() {
  refresh()
  loadQuota()
}

async function reset() {
  try {
    await window.api.resetUsage()
    await refresh()
    toast.success(t('stats.cleared'))
  } catch (err) {
    toast.error(t('stats.clear_failed') + ': ' + err.message)
  }
}

let timer = null
onMounted(() => {
  refresh()
  loadQuota()
  // Periodic quota refresh (every 60s), not just once at mount
  timer = setInterval(() => {
    loadQuota()
    refresh()
  }, 60000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="view">
    <header class="view-head">
      <div class="head-title">
        <h1>{{ t('stats.title') }}</h1>
        <p class="sub">{{ t('stats.sub') }}</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-sm" :disabled="loading || quotaLoading" @click="refreshAll">
          <span v-if="loading || quotaLoading" class="spin"></span>
          <Icon v-else name="refresh" :size="15" />
          <span>{{ t('stats.refresh') }}</span>
        </button>
      </div>
    </header>

    <div class="scroll">
      <section class="card quota-card">
        <div class="quota-head">
          <div class="quota-head-l">
            <span class="quota-ic"><Icon name="plug" :size="18" /></span>
            <div>
              <div class="quota-title">{{ t('stats.quota_title') }}</div>
              <div class="quota-prov">{{ t('settings.active_provider') }}: {{ provider?.name || t('stats.no_provider') }}</div>
            </div>
          </div>
          <button class="btn btn-sm btn-ghost" :disabled="quotaLoading" @click="loadQuota">
            <span v-if="quotaLoading" class="spin"></span>
            <Icon v-else name="refresh" :size="14" />
            <span>{{ t('stats.search') }}</span>
          </button>
        </div>

        <template v-if="quota">
          <div class="quota-nums">
            <div class="qn">
              <div class="qn-num remain">{{ money(quota.remaining) }}</div>
              <div class="qn-label">{{ t('stats.remaining') }}</div>
            </div>
            <div class="qn">
              <div class="qn-num">{{ money(quota.total) }}</div>
              <div class="qn-label">{{ t('stats.total') }}</div>
            </div>
            <div class="qn">
              <div class="qn-num">{{ money(quota.used) }}</div>
              <div class="qn-label">{{ t('stats.used') }}</div>
            </div>
          </div>
          <div v-if="usedPct != null" class="quota-bar">
            <div class="quota-fill" :style="{ width: usedPct + '%' }"></div>
          </div>
          <div v-if="usedPct != null" class="quota-pct">{{ t('stats.used') }} {{ usedPct }}%</div>
        </template>
        <div v-else-if="quotaLoading" class="quota-msg">{{ t('stats.qn_loading') }}</div>
        <div v-else class="quota-msg">{{ quotaErr || t('stats.qn_error') }}</div>
      </section>

      <h3 class="section-h">{{ t('stats.local_title') }}</h3>
      <div class="kpi-grid">
        <div v-for="c in KIND_CARDS" :key="c.key" class="kpi">
          <span class="kpi-ic"><Icon :name="c.icon" :size="18" /></span>
          <div class="kpi-main">
            <div class="kpi-num">{{ kindCount(c.key) }}</div>
            <div class="kpi-label">{{ c.label }}</div>
          </div>
        </div>
      </div>

      <section class="card sum-card">
        <div class="sum-item">
          <div class="sum-num">{{ genTotal }}</div>
          <div class="sum-label">{{ t('stats.total_generated') }}</div>
        </div>
        <div
          class="sum-item clickable"
          :class="{ active: sumFilter === 'requests' }"
          :title="t('stats.filter_hint')"
          @click="sumFilter = 'requests'"
        >
          <div class="sum-num">{{ totalReq }}</div>
          <div class="sum-label">{{ t('stats.total_requests') }}</div>
        </div>
        <div
          class="sum-item clickable"
          :class="{ active: sumFilter === 'tokens' }"
          :title="t('stats.filter_hint')"
          @click="sumFilter = 'tokens'"
        >
          <div class="sum-num">{{ fmtNum((tokens.in || 0) + (tokens.out || 0)) }}</div>
          <div class="sum-label">{{ t('stats.tokens_total') }}</div>
        </div>
        <div class="sum-item">
          <div class="sum-num ok">{{ usage?.ok || 0 }}</div>
          <div class="sum-label">{{ t('stats.success') }}</div>
        </div>
        <div class="sum-item">
          <div class="sum-num bad">{{ usage?.fail || 0 }}</div>
          <div class="sum-label">{{ t('stats.failed') }}</div>
        </div>
        <div class="sum-item">
          <div class="sum-num">{{ okRate }}%</div>
          <div class="sum-label">{{ t('stats.success_rate') }}</div>
        </div>
      </section>

      <div class="two-col">
        <section class="card block">
          <h3 class="block-title">{{ sumFilter === 'tokens' ? t('stats.chart_tokens_title') : t('stats.chart_requests_title') }}</h3>
          <div class="bars">
            <div v-for="d in chartDays" :key="d.key" class="bar-col">
              <div class="bar-wrap">
                <div class="bar" :style="{ height: Math.round((d.n / maxDay) * 100) + '%' }">
                  <span v-if="d.n" class="bar-n">{{ sumFilter === 'tokens' ? fmtCompact(d.n) : d.n }}</span>
                </div>
              </div>
              <span class="bar-label">{{ d.label }}</span>
            </div>
          </div>
        </section>

        <section class="card block">
          <div class="block-title-row">
            <h3 class="block-title">{{ sumFilter === 'tokens' ? t('stats.models_tokens_title') : t('stats.models_requests_title') }}</h3>
            <button class="btn btn-sm btn-ghost" @click="reset"><Icon name="trash" :size="13" /><span>{{ t('stats.clear') }}</span></button>
          </div>
          <div v-if="topList.length" class="models">
            <div v-for="[m, n] in topList" :key="m" class="model-row">
              <span class="model-name" :title="m">{{ m }}</span>
              <div class="model-bar-wrap">
                <div class="model-bar" :style="{ width: Math.round((n / maxModel) * 100) + '%' }"></div>
              </div>
              <span class="model-n">{{ sumFilter === 'tokens' ? fmtCompact(n) : n }}</span>
            </div>
          </div>
          <p v-else class="empty-line">{{ t('stats.no_data') }}</p>
        </section>
      </div>

      <!-- token usage card (chat / optimize / image requests that report usage) -->
      <section class="card tok-card">
        <h3 class="block-title">{{ t('stats.tokens_title') }}</h3>
        <template v-if="hasTokens">
          <div class="tok-sums">
            <div class="tok-sum clickable" :class="{ active: tokFilter === 'in' }" :title="t('stats.filter_hint')" @click="tokFilter = 'in'">
              <div class="tok-num">{{ fmtNum(tokens.in) }}</div>
              <div class="tok-label">{{ t('stats.tokens_input') }}</div>
            </div>
            <div class="tok-sum clickable" :class="{ active: tokFilter === 'out' }" :title="t('stats.filter_hint')" @click="tokFilter = 'out'">
              <div class="tok-num">{{ fmtNum(tokens.out) }}</div>
              <div class="tok-label">{{ t('stats.tokens_output') }}</div>
            </div>
            <div class="tok-sum accent clickable" :class="{ active: tokFilter === 'total' }" :title="t('stats.filter_hint')" @click="tokFilter = 'total'">
              <div class="tok-num">{{ fmtNum((tokens.in || 0) + (tokens.out || 0)) }}</div>
              <div class="tok-label">{{ t('stats.tokens_total') }}</div>
            </div>
          </div>

          <h4 class="tok-sub">{{ t('stats.recent_7d') }}</h4>
          <div class="tok-bars">
            <div v-for="d in tDays" :key="d.key" class="tbar-col">
              <div class="tbar-wrap">
                <div
                  class="tbar"
                  :style="{ height: Math.max(tokVal(d.tok) ? 4 : 0, Math.round((tokVal(d.tok) / maxTokDay) * 100)) + '%' }"
                >
                  <template v-if="d.tok && tokFilter !== 'total'">
                    <div :class="tokFilter === 'in' ? 'tbar-in' : 'tbar-out'" style="flex: 1"></div>
                  </template>
                  <template v-else-if="d.tok">
                    <div class="tbar-in" :style="{ flex: d.tok.in || 0 }"></div>
                    <div class="tbar-out" :style="{ flex: d.tok.out || 0 }"></div>
                  </template>
                </div>
              </div>
              <span class="bar-label">{{ d.label }}</span>
            </div>
          </div>

          <template v-if="topTokModels.length">
            <h4 class="tok-sub">{{ t('stats.tokens_by_model') }}</h4>
            <div class="tok-models">
              <div v-for="m in topTokModels" :key="m.model" class="tok-model-row">
                <span class="model-name" :title="m.model">{{ m.model }}</span>
                <div class="tok-model-bars">
                  <div class="tbar h">
                    <template v-if="tokFilter !== 'total'">
                      <div :class="tokFilter === 'in' ? 'tbar-in' : 'tbar-out'" :style="{ width: (m.v / maxTokModel) * 100 + '%' }"></div>
                    </template>
                    <template v-else>
                      <div class="tbar-in" :style="{ width: (m.in / maxTokModel) * 100 + '%' }"></div>
                      <div class="tbar-out" :style="{ width: (m.out / maxTokModel) * 100 + '%' }"></div>
                    </template>
                  </div>
                </div>
                <span class="tok-model-n">{{ fmtNum(m.v) }}</span>
              </div>
            </div>
          </template>
          <p v-else class="empty-line">{{ t('stats.no_data') }}</p>
        </template>
        <p v-else class="empty-line">{{ t('stats.tokens_none') }}</p>
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
.scroll {
  flex: 1;
  overflow-y: auto;
  padding: 20px 34px 40px;
  width: 100%;
}

.quota-card {
  padding: 18px 20px;
  margin-bottom: 18px;
}
.quota-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.quota-head-l {
  display: flex;
  align-items: center;
  gap: 12px;
}
.quota-ic {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
}
.quota-title {
  font-size: 14px;
  font-weight: 650;
}
.quota-prov {
  font-size: 12px;
  color: var(--text-3);
}
.quota-nums {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}
.qn {
  text-align: center;
  padding: 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-1);
  border: 1px solid var(--border);
}
.qn-num {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.qn-num.remain {
  color: var(--accent);
}
.qn-label {
  font-size: 11.5px;
  color: var(--text-3);
  margin-top: 3px;
}
.quota-bar {
  height: 9px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}
.quota-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--accent-hover));
  transition: width 0.4s ease;
}
.quota-pct {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--text-3);
  text-align: right;
}
.quota-msg {
  font-size: 12.5px;
  color: var(--text-3);
  padding: 6px 0;
}

.section-h {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 650;
  color: var(--text-2);
}
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.kpi {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
}
.kpi-ic {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
}
.kpi-num {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.kpi-label {
  font-size: 12px;
  color: var(--text-3);
  margin-top: 2px;
}
.sum-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.sum-item {
  flex: 1;
  min-width: 70px;
  text-align: center;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
}
.sum-num {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.sum-num.ok {
  color: var(--success);
}
.sum-num.bad {
  color: var(--danger);
}
.sum-label {
  font-size: 11.5px;
  color: var(--text-3);
  margin-top: 2px;
}

/* clickable metric cards act as filters for the charts below */
.clickable {
  cursor: pointer;
  user-select: none;
  transition: box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}
.clickable:hover {
  border-color: var(--accent-line);
  box-shadow: 0 0 0 1px var(--accent-line), 0 4px 16px var(--accent-soft);
  transform: translateY(-1px);
}
.sum-item.clickable:hover {
  background: var(--surface-2);
}
.sum-item.active {
  background: var(--accent-soft);
}
.sum-item.active .sum-num {
  color: var(--accent);
}
.tok-sum.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.tok-sum.active .tok-num {
  color: var(--accent);
}
.two-col {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 14px;
}
.block {
  padding: 18px 20px;
}
.block-title {
  margin: 0 0 16px;
  font-size: 13.5px;
  font-weight: 650;
}
.block-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.block-title-row .block-title {
  margin: 0;
}
.bars {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 130px;
}
.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  height: 100%;
}
.bar-wrap {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.bar {
  width: 62%;
  min-height: 3px;
  border-radius: 6px 6px 0 0;
  background: linear-gradient(180deg, var(--accent), var(--accent-soft));
  position: relative;
  transition: height 0.3s ease;
}
.bar-n {
  position: absolute;
  top: -16px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10.5px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.bar-label {
  font-size: 10.5px;
  color: var(--text-3);
}
.models {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.model-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.model-name {
  flex: 0 1 180px;
  min-width: 80px;
  font-size: 12.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-bar-wrap {
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: var(--surface-2);
  overflow: hidden;
}
.model-bar {
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width 0.3s ease;
}
.model-n {
  width: 36px;
  text-align: right;
  font-size: 12px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.empty-line {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-3);
}

/* token usage card */
.tok-card { padding: 18px 20px 20px; margin-top: 14px; }
.tok-sums { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin: 14px 0 18px; }
.tok-sum { text-align: center; padding: 12px 10px; border-radius: var(--radius-sm); background: var(--bg-1); border: 1px solid var(--border); }
.tok-num { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tok-sum.accent .tok-num { color: var(--accent); }
.tok-label { font-size: 11.5px; color: var(--text-3); margin-top: 3px; }
.tok-sub { margin: 0 0 12px; font-size: 12.5px; font-weight: 650; color: var(--text-2); }
.tok-bars { display: flex; align-items: flex-end; gap: 10px; height: 130px; }
.tbar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 7px; height: 100%; }
.tbar-wrap { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
.tbar { width: 62%; border-radius: 6px; background: var(--surface-2); display: flex; flex-direction: column; overflow: hidden; transition: height 0.3s ease; }
.tbar.h { width: 100%; height: 7px; flex-direction: row; }
.tbar-in { background: var(--accent); }
.tbar-out { background: var(--accent-soft); }
.tok-models { display: flex; flex-direction: column; gap: 10px; }
.tok-model-row { display: flex; align-items: center; gap: 10px; }
.tok-model-bars { flex: 1; }
.tok-model-n { width: 70px; text-align: right; font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; }
</style>
