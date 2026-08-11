# WhatWhen

A tiny always-on-top **workday profile timer** for Windows. Switch profiles with hotkeys, jot what you did in a chat bubble when you leave a slot, and review a clean Markdown log each day.

## Features

- **Frosted glass orb** in the bottom-right of the primary display
- **6 profiles** with a chromatic rainbow palette (aeroglass radial picker)
- **Global hotkeys**: `Ctrl+Shift+Alt+1`–`6` to switch; `Ctrl+Shift+Alt+\`` to stop
- On switch/stop: **chat bubble** above the orb for brief notes (Enter save, Esc skip back)
- **Session stack**: click the orb to see pending note circles (oldest top → newest bottom); click one to edit
- **Daily Markdown** logs in `Documents\WhatWhen\YYYY-MM-DD.md`

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run dist
```

Installers land in `release/` (`WhatWhen Setup x.y.z.exe` + portable).

### Auto Windows builds on release

Publishing a **GitHub Release** runs [`.github/workflows/release.yml`](.github/workflows/release.yml):

1. Optionally bump `"version"` in `package.json` and push.
2. GitHub → **Releases** → **Draft a new release**.
3. Create a tag like `v1.0.1`, write notes, **Publish release**.
4. CI builds on `windows-latest` and **uploads the `.exe` files onto that release**.

You can also run the workflow manually under **Actions → Release** (downloads as workflow artifacts; only a published release gets assets attached).

> Builds are **unsigned**. Windows SmartScreen may warn until you add code signing later.

## Hotkeys

| Key | Action |
|-----|--------|
| `Ctrl+Shift+Alt+1` … `6` | Switch to profile 1–6 |
| `Ctrl+Shift+Alt+\`` | Stop timer (idle) |

## UI

| Gesture | Result |
|---------|--------|
| Left-click orb | Toggle pending session stack |
| Click a stack circle | Open chat bubble for that session |
| Enter (in bubble) | Save notes → back to stack |
| Esc (in bubble) | Back to stack without saving |
| Esc (on stack) | Collapse to orb only |
| Right-click orb | Open today’s log, folder, quit |

## Data

- Config & crash recovery: `%APPDATA%\whatwhen\WhatWhen\`
- Logs: `%USERPROFILE%\Documents\WhatWhen\`

Rename profiles later via config JSON (`config.json` → `profiles`) or a future settings UI.
