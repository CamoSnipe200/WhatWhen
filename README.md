# WhatWhen

A tiny always-on-top **workday profile timer** for Windows. Switch profiles with hotkeys, jot what you did in a chat bubble when you leave a slot, and review a clean Markdown log each day.

## Features

- **Frosted glass orb** in the bottom-right of the primary display
- **12 profiles** on three wheel rings; palette defaults sit at the top of Edit profiles
- **Global hotkeys**: `Ctrl+Shift+Alt+1`–`9` to switch; `Ctrl+Shift+Alt+\`` to stop
- On switch/stop: **chat bubble** above the orb for brief notes (Enter save, Esc skip back)
- **Session stack**: click the pending badge to see pending note circles (oldest top → newest bottom); click one to edit
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
| `Ctrl+Shift+Alt+1` … `9` | Switch to profile 1–9 |
| `Ctrl+Shift+Alt+\`` | Stop timer (idle) |

## UI

| Gesture | Result |
|---------|--------|
| Left-click orb | Open / close the profile wheel |
| Click the pending badge | Open the pending notes stack |
| Click × | Stop and keep the segment (asks for notes) |
| Hold × for ~0.7 s | Stop and discard the segment |
| Click a stack circle | Open chat bubble for that session |
| Enter (in bubble) | Save notes → back to stack |
| Esc (in bubble) | Back to stack without saving |
| Esc (on stack) | Collapse to orb only |
| Right-click orb | Open today’s log, folder, quit |
| Date chip (Analysis / Timeline) | Pick a past day or a date range |

## Calendar

Open Analysis or Timeline, then click the date chip for a month grid.

- Click a day to view that day.
- Shift+click a day to extend the current range to that day.
- Use **Last 7 days** or **This week** for a quick range. Use **Today** to return to today.
- Analysis aggregates every day in the selected range.
- Timeline shows one day. When a range is selected, use ‹ › to move between days in that range.
- The view resets to today when you close the overlay.

## Stories & colors

A slot is a hotkey position, not a permanent story.

- Edit the name and color of a slot in **Edit profiles…**.
- Click the color swatch to open a palette. Each color has a filled swatch and an outline swatch. There is no OS color dialog.
- Slots 8–12 start as outlines of colors 1–5. Any slot can use a fill or an outline.
- Click **⟲** to start a new profile on that slot. You may reuse the same color. Shared colors on slots 1–7 get dots or hatching (up to 5 marks, then they repeat).
- **Past sessions keep the name and color they were recorded under.** Analysis over a range that crosses a retirement shows both profiles as separate slices.
- Reassign a past session in the Timeline and it moves to the story that occupies that slot *now*.
- A running timer stays on the old story until you switch.

## Data

- Config & crash recovery: `%APPDATA%\whatwhen\WhatWhen\`
- Logs: `%USERPROFILE%\Documents\WhatWhen\`
- Daily JSON (`YYYY-MM-DD.json`) is the source of truth. Markdown (`.md`) is generated from it.
- `config.json` → `profiles[].epoch` (integer, bumped on retire).
- `YYYY-MM-DD.json` → `sessions[].profileEpoch` (absent on pre-Wave-4 logs, read as 0).
