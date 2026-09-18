import { createApp } from 'vue'
import App from './App.vue'
import i18n from './i18n'
import './assets/styles.css'

// Apply the saved theme before mount to avoid a first-paint flash of the default color
// (real persistence lives in settings.json)
try {
  document.documentElement.dataset.theme = localStorage.getItem('rawphotos-theme') || 'sky'
} catch {
  // localStorage unavailable: ignore, loadSettings still applies the theme
}

createApp(App).use(i18n).mount('#app')