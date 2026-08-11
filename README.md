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

Installers land in `release/`.

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
