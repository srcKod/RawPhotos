<div align="center">

# RawPhotos

**AI Text-to-Image / Text-to-Video / Image-to-Image / AI Chat Desktop Application**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/yz46bbbqqz-rgb/RawPhotos?color=success)](https://github.com/yz46bbbqqz-rgb/RawPhotos/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/yz46bbbqqz-rgb/RawPhotos/total?color=brightgreen)](https://github.com/yz46bbbqqz-rgb/RawPhotos/releases)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6)
[![Stars](https://img.shields.io/github/stars/yz46bbbqqz-rgb/RawPhotos?style=flat&color=yellow)](https://github.com/yz46bbbqqz-rgb/RawPhotos/stargazers)

Complete image generation, video generation, image editing, and AI chat in one desktop app using any OpenAI-compatible proxy interface.

Built with Electron + Vue 3 · Windows desktop application

[Community Support](https://linux.do)

</div>

---

## 🔎 Quick Start Guide

- [Disclaimer](#-disclaimer)
- [Features](#-features)
- [Getting Started](#-getting-started)
- [Interface Configuration](#️-interface-configuration)
- [Feature Details](#-feature-details)
- [Data Storage Location](#️-data-storage-location)
- [Build from Source](#-build-from-source)
- [Project Structure](#-project-structure)
- [Tech Stack](#️-tech-stack)
- [License](#-license)
- [Community Support](#-community-support)

---

## 📢 Disclaimer

This project is for learning, research, and personal use only. Any third-party interfaces, models, or generated content accessed through this project are used at your own risk.

This project is a **pure client-side application**: it contains no built-in models and provides no interfaces. It simply connects your own "proxy/aggregation interface" to make calls. Your API Key is stored locally only, and requests are sent directly from the main process without passing through any third-party servers.

This project is not affiliated with OpenAI, Anthropic, xAI, Google, or any other model/interface provider.

---

## ✨ Features

- **Text-to-Image**: Generate images from prompts, 1-4 per request with optional dimensions; supports **generation queue** for sequential processing
- **Text-to-Video**: Generate videos from prompts with sync/async polling support; configurable dimensions and duration
- **Image-to-Image**: Upload reference image with prompt for editing via `/images/edits`
- **AI Prompt Optimization**: Expand prompts using chat models for better results
- **AI Chat**:
  - **Independent interface and model selection** — use different proxies for image vs chat
  - Auto-save conversation history, history list, export as Markdown
  - Supports image (vision) and file uploads
  - Markdown rendering, stop generation, clear chat, copy messages
- **Multiple Interface Management**: Save multiple proxy interfaces with their addresses, API Keys, image/video/chat models, and dimensions; one-click "set as current"; models auto-populated from `/models` or manual input
- **Gallery**: Browse saved local images and videos with type filters
- **Usage Statistics**: Track counts, success rate, 7-day trends, top models
- **Quota Display**: Auto-check and display current interface quota in sidebar and stats page; set low quota alerts
- **Runtime Logs**: Record request status codes and raw responses for debugging
- **Theme System**: Sky / Green / Dark + custom colors, auto-memory
- **Tray Operation**: Minimize to tray or exit completely

---

## 🚀 Getting Started

### Option 1: Download Pre-built (Recommended)

Go to [Releases](https://github.com/yz46bbbqqz-rgb/RawPhotos/releases) to download:

- **Installer** `RawPhotos Setup x.y.z.exe`: Double-click to install, can customize location and create shortcuts
- **Portable** `RawPhotos-portable-x.y.z.zip`: Extract and run `RawPhotos.exe` without installation

First launch → Go to Settings → Enter proxy address + API Key → Ready to use.

### Option 2: Run from Source

```bash
# Requires Node.js 18+
npm install
npm run dev
```

> If you encounter `Error: Electron uninstall` after `npm install`, use mirror:
>
> ```powershell
> $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; node node_modules/electron/install.js
> ```

---

## ⚙️ Interface Configuration

Go to Settings → Interface Configuration → Add Interface to save proxies:

| Field | Description | Example |
| --- | --- | --- |
| Interface Name | Custom label | `My Relay` / `gpt` |
| Base URL | OpenAI-compatible endpoint | `https://your-relay.com/v1` |
| API Key | Interface key | `sk-...` |
| Image Model | Text-to-image model | `grok-imagine-image` / `flux` |
| Video Model | Text-to-video model | `grok-imagine-video` |
| Optimize Model | Chat model for prompt optimization | `gpt-4o-mini` |
| Dimensions / Duration | Optional | `1024x1024` |

Models can be **auto-populated from `/models`** or manually entered.

---

## 🧩 Feature Details

### Generation (Text-to-Image / Text-to-Video / Image-to-Image)
Click "Generate" to switch between image / video modes. Image mode supports uploading **reference images** for image-to-image editing. Clicking generate adds to queue for sequential processing; results display as cards, saveable/exportable with zoom preview.

### AI Chat
Left sidebar shows conversation history, right side is chat area. **Bottom allows independent selection of "interface" and "model"** — so chat can use different interfaces than image generation without conflicts. Supports image (vision)/text file uploads, Markdown rendering, stop generation, clear, export `.md`. History auto-saves and persists after restart.

### Gallery
Browse saved images and videos with type filters (all/image/video), supports save-as.

### Usage Statistics & Quota
Stats page shows **quota card** (remaining/total/used + progress bar, auto-refresh) and local usage stats (by type/model/7-day trends) and success rate. Remaining quota also displayed in bottom-left of sidebar.

### Low Quota Alert
Enable in Settings → Quota Alert, checks every 60 seconds and notifies on low balance.

### Runtime Logs
Each image/video/optimize/chat/test request logs status code and **raw responses**, persists locally, searchable.

### Theme & Window
Sky / Green / Dark themes with custom colors, auto-memory. Close window to minimize to tray or exit; tray icon restores window.

---

## 🗂️ Data Storage Location

Application data stored in system user directory (Windows: `%APPDATA%/RawPhotos`):

| File | Content |
| --- | --- |
| `settings.json` | All settings (interfaces, theme, alerts, etc.) |
| `rawphotos-chats.json` | Conversation history |
| `rawphotos-usage.json` | Usage statistics |
| `rawphotos.log` | Runtime logs (JSONL format) |

- Generated images/videos stored in "Pictures/RawPhotos" by default, configurable in settings
- API Key stored locally only, requests sent from main process

---

## 📦 Build from Source

```bash
npm run dist:win
```

Output in `release/`: NSIS installer `RawPhotos Setup x.y.z.exe`.

> **Windows Build Tips**: electron-builder downloads `winCodeSign` / `nsis` toolchain, and extracts Electron while antivirus scans—**don't interrupt**, wait for "unpacking default Electron distribution" step. You can set mirrors:
>
> ```powershell
> $env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
> $env:CSC_IDENTITY_AUTO_DISCOVERY="false"   # Skip code signing
> npm run dist:win
> ```

---

## 📁 Project Structure

```
RawPhotos/
├── src/
│   ├── main/index.js        # Main process: windows/tray, IPC, API calls, settings/history/stats/logs, rawmedia protocol
│   ├── preload/index.js     # Preload: exposes window.api via contextBridge
│   └── renderer/            # Vue frontend
│       ├── index.html
│       └── src/
│           ├── App.vue          # Shell: navigation, theme, quota, close dialog, alerts
│           ├── store.js         # Settings, chat results, theme
│           ├── components/      # Generate/chat/gallery/statistics/logs/settings/about + media cards, lightbox, dropdown, icon, Toast
│           └── composables/
├── resources/icon.png       # Runtime icon (tray, window, notifications)
├── build/icon.png           # Build icon
├── electron-builder.yml     # Build configuration
├── electron.vite.config.mjs
├── AGENTS.md                # Engineering memory for AI assistants
└── package.json
```

---

## 🛠️ Tech Stack

- **Electron 42** + **electron-vite**
- **Vue 3** (`<script setup>`) + **Vite**
- `marked` (Chat Markdown rendering)
- **electron-builder** (Windows NSIS packaging)

> Engineering design guidelines for AI assistants are in [`AGENTS.md`](./AGENTS.md).

---

## 📄 License

This project is licensed under the [Apache License 2.0](./LICENSE); third-party library licenses are listed in [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

> This is a modified fork of [yz46bbbqqz-rgb/RawPhotos](https://github.com/yz46bbbqqz-rgb/RawPhotos), maintained and extended by [srcKod](https://github.com/srcKod); it is not affiliated with or endorsed by the original authors.

---

## 💬 Community Support

Welcome to [linux.do](https://linux.do) to discuss, share, and provide feedback.

---

<div align="center">
If this project has helped you, please give it a ⭐
</div>