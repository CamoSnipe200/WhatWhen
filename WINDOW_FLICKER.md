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

### Keep common modes on stable bounds

Idle, radial wheel, pending stack, and note bubble should share the same
minimum bounds. Large pending stacks may increase the shared stack/bubble
height, but opening an individual pending note must not resize the window.

This invariant lives in `src/main/window.ts`.

### Hide before crossing centered/anchored layouts

Analysis and Timeline are centered; the orb modes are anchored. One window
cannot occupy both positions, so `pushState()` must:

1. Hide the window.
2. Apply the new bounds atomically with one `setBounds()` call.
3. Apply focus/mouse policy.
4. Send renderer state.
5. When closing Analysis/Timeline, keep the window hidden for 500 ms so the
   old centered surface is fully gone, then show the anchored window at zero
   opacity and fade it in.

Do not move or resize the visible window during this transition. The deliberate
half-second pause is a UX boundary: the overlay disappears immediately, then
the orb returns as a separate fade rather than exposing stale compositor
frames. Opening a review overlay uses only a short hidden settle delay.

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
