# Preventing transparent-window flicker

WhatWhen uses one frameless, transparent, always-on-top Electron
`BrowserWindow`. On Windows, changing that window's bounds can briefly show its
previous Chromium surface at the new origin before Chromium has laid out the
new viewport.

## What the bug looks like

- The orb or pending circles flash hundreds of pixels up and left.
- Analysis or Timeline flashes in the bottom-right corner while closing.
- The artifact lasts one to four frames and is easiest to see in a 30 FPS
  recording.

The displacement usually equals the difference between the old and new window
dimensions. That is the signal that this is a native-window/compositor ordering
problem, not incorrect CSS coordinates.

## Causes

1. `BrowserWindow.setBounds()` moves/resizes a transparent HWND while its old
   rendered surface is still available to the Windows compositor.
2. Renderer state is sent before the main process applies its visibility and
   bounds policy. The renderer can then paint the next UI into the old viewport.
3. Applying CSS transforms to persistent backdrop-filtered controls (for
   example, scaling the orb on `:active`) promotes/demotes compositor layers and
   can briefly paint a layer at the HWND origin.

## Required safeguards

### Size each mode to its UI

Idle uses an orb-tight HWND so empty glass cannot steal scroll from apps
underneath. Wheel, stack/bubble, settings, and centered overlays each use
their own bounds. Stack and note bubble still share one footprint so opening
a pending note does not resize mid-interaction.

### Hide before grow / centered moves; fade-shrink on close

Resizing a transparent HWND while visible can flash the previous Chromium
surface at the new origin.

**Growing** (idle → wheel) or crossing Analysis/Timeline: hide first, apply
bounds, send state, then reveal with a short opacity fade (~100 ms). The orb
briefly disappears on open — keeping it painted across a grow in one HWND is
not possible without a second window.

**Shrinking** (wheel/stack → idle): do **not** hide. Send the idle state first
so the renderer can fade out wheel/stack chrome (~120 ms) while the orb stays
on the still-large HWND, then crop bounds without `hide()`. That removes the
multi-frame blank orb seen when close used a full hide.

### Route every state change through `pushState()`

Never call:

```ts
orbWindow.webContents.send('state-changed', service.snapshot())
```

directly from a `SessionService` change listener. Doing so bypasses the native
window guard and reintroduces intermittent close flicker. The listener must
call `pushState()`, which applies native layout before sending renderer state.

### Prevent the white focus strip

Windows can draw a bright DWM focus strip on a focused, transparent,
frameless window—especially when it is nearly work-area width. Analysis and
Timeline must remain non-focusable and be shown with `showInactive()`.
Mouse clicks and hover still work; a temporary global Escape accelerator
preserves keyboard dismissal while either review overlay is visible. Only
note/settings modes, which require keyboard entry, should make the window
focusable.

After any focusable episode (note bubble, settings, or the native context
menu), call `clearTransparentFocus()`: `setFocusable(false)`, `blur()`,
reset shadow/background, and `showInactive()` **only if the window is still
visible**. Never `showInactive()` while `pushState()` has the window hidden
for a centered/anchored transition — that would undo the hide-before-resize
guard. Reaffirm inactive state at the end of the Analysis/Timeline close fade.

### Do not transform persistent glass controls

Do not use `transform: scale(...)` on the main orb or pending circles for
pressed/hover feedback. Use border color, brightness, or opacity instead.
Timeline-only labels may be rotated because they are not preserved across a
native window resize.

### Avoid redundant bounds writes

Compare the complete current and target bounds before calling `setBounds()`.
Set position and size together; never call `setPosition()` and `setSize()`
separately for these windows.

## Verification

Do not launch WhatWhen from an agent session. When testing manually:

1. Record at 30 FPS or higher.
2. Repeatedly open/close the wheel.
3. Open Pending notes and click several pending circles.
4. Open/close Analysis and Timeline using both the close button and orb.
5. Inspect transition frames. No previous UI should appear at another screen
   position, even for one frame.
