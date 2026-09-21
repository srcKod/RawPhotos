# Changelog

All notable changes to RawPhotos are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Bilingual interface (English / 简体中文)** — full i18n via vue-i18n with English as the
  default language and a language switcher in the sidebar. Every view, toast, dialog,
  window-control label, and file-dialog filter is translated, and the Electron main process
  (log entries, error messages, provider presets, default chat title) shares the same
  en/zh catalogs through `@intlify/core-base`, so adding a third language stays a
  JSON-only task.
- **OpenAI Videos (Sora-style) video adapter** — a per-provider *Video API style* setting
  now supports the legacy `/videos/generations` flow, the OpenAI Videos flow
  (`POST /videos` create, `video_id` polling, `metadata.url` download), and a strict
  Google-Gemini mode that sends only `model` + `prompt` at the top level with optional
  parameters inside `extra_body`. No base URL, key, or model name is hardcoded —
  any Sora-compatible provider works through configuration alone.
- **Built-in provider presets** — Google Gemini (compat) with
  `gemini-2.5-flash-image` + `veo-3.1-generate-preview`, and Volcano Ark (Seedream) with
  `doubao-seedream-4-0-250828`. Presets are seeded idempotently and self-heal existing
  configurations on startup.
- **Local agent tools in AI Chat** — the model can list directories, read and write files,
  and run commands inside an isolated agent workspace, with per-tool permission gating
  before anything executes.
- **Reasoning-model support in AI Chat** — thinking/reasoning output is parsed into a
  separate collapsible block instead of leaking into the answer text.
- **Manual model IDs everywhere** — model IDs typed manually in Settings (image, video,
  and chat) merge with the provider's `/models` results: deduplicated when the endpoint
  returns them, added alongside when it doesn't, with no filtering or validation applied.
- **License compliance files** — `THIRD-PARTY-NOTICES.md` with MIT notices for the bundled
  libraries (Vue, vue-i18n, marked, Electron), an explicit `license` field in
  `package.json`, and Apache-2.0 / fork-modification notices in the README.

### Changed

- README consolidated into a single English document (the separate `README_EN.md` was
  dropped).
- Renderer locale catalogs contain no interpolation syntax, keeping the renderer
  CSP-safe; main-process messages use single-brace `{param}` interpolation (safe — Node
  has no CSP).
- `.vscode/` is excluded from version control.

### Fixed

- Chat model list: a manually chosen provider model no longer disappears after models
  load or after picking another model.
- Settings theme cards displayed raw translation keys (`theme.green`) instead of names.
- Provider name field was mislabeled "Base URL" (now "Provider Name"; the `/v1` field
  keeps the "Base URL" label).
- Advanced path fields now carry the correct labels ("Image Edit Path", "Video Path").
- Stats quota display showed a doubled `%%`.
- Several i18n wiring bugs (language-switch import conflict, temporal-dead-zone crash,
  computed-ref comparisons, loop variables shadowing `t`) that left some labels
  untranslated.

## [1.2.0] - 2026-07-02

### Added

- Image-to-video generation: pass a reference image directly in the `image` field,
  with or without a prompt.
- Preset for the nexus GPT drawing interface (`gpt-image-2`).

### Changed

- Moonlight theme reworked to a blue-gray base with a soft blue accent.

### Fixed

- Image-to-video `image` field now retries across object / array / string shapes
  (nexus serde expects a non-string type).
- Chat history was never persisted — reactive proxies threw clone errors over IPC that
  were silently swallowed; conversations now save and the most recent one is restored
  on open.
- Contrast issues between the dark and light themes.

## [1.1.0] - 2026-06-30

Initial tagged release: AI text-to-image / text-to-video / image editing / AI chat
desktop application with configurable OpenAI-compatible providers.

[Unreleased]: https://github.com/srcKod/RawPhotos/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/srcKod/RawPhotos/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/srcKod/RawPhotos/releases/tag/v1.1.0
