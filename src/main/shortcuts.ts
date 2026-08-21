import { app, globalShortcut } from 'electron'
import { PROFILE_SLOTS, type ProfileSlot } from '../shared/types'
import type { SessionService } from './session-service'

/** Prefer Ctrl (Windows); CommandOrControl as fallback string. */
function slotAccelerators(slot: ProfileSlot): string[] {
  const n = String(slot)
  return [
    `Control+Shift+Alt+${n}`,
    `Ctrl+Shift+Alt+${n}`,
    `CommandOrControl+Shift+Alt+${n}`
  ]
}

const STOP_ACCELS = [
  'Control+Shift+Alt+`',
  'Ctrl+Shift+Alt+`',
  'CommandOrControl+Shift+Alt+`',
  // Some layouts / Electron builds prefer Oem_3 for backtick
  'Control+Shift+Alt+Oem_3'
]

/** Insert segment / comment on current profile */
const COMMENT_ACCELS = [
  'Control+Shift+Alt+N',
  'Ctrl+Shift+Alt+N',
  'CommandOrControl+Shift+Alt+N'
]

/** Recover stuck orb visibility / mouse policy (slot 0 is unused). */
const RECOVER_ACCELS = [
  'Control+Shift+Alt+0',
  'Ctrl+Shift+Alt+0',
  'CommandOrControl+Shift+Alt+0'
]

export type ShortcutMap = { slot: ProfileSlot; accel: string }[]

export function registerShortcuts(
  service: SessionService,
  onAfter: () => void,
  onRecover?: () => void
): boolean {
  if (!app.isReady()) {
    console.warn('registerShortcuts called before app ready')
    return false
  }

  try {
    globalShortcut.unregisterAll()
  } catch (err) {
    console.warn('unregisterAll before register failed', err)
  }

  let ok = true
  const registered: string[] = []

  for (const slot of PROFILE_SLOTS) {
    let done = false
    for (const accel of slotAccelerators(slot)) {
      try {
        const registeredOk = globalShortcut.register(accel, () => {
          service.switchProfile(slot)
          onAfter()
        })
        if (registeredOk) {
          registered.push(accel)
          done = true
          break
        }
      } catch (err) {
        console.warn(`Error registering ${accel}`, err)
      }
    }
    if (!done) {
      console.warn(`Failed to register any accelerator for profile slot ${slot}`)
      ok = false
    }
  }

  let stopDone = false
  for (const accel of STOP_ACCELS) {
    try {
      const stopOk = globalShortcut.register(accel, () => {
        service.stop()
        onAfter()
      })
      if (stopOk) {
        registered.push(accel)
        stopDone = true
        break
      }
    } catch (err) {
      console.warn(`Error registering stop ${accel}`, err)
    }
  }
  if (!stopDone) {
    console.warn('Failed to register stop shortcut')
    ok = false
  }

  let commentDone = false
  for (const accel of COMMENT_ACCELS) {
    try {
      const commentOk = globalShortcut.register(accel, () => {
        service.insertSegment()
        onAfter()
      })
      if (commentOk) {
        registered.push(accel)
        commentDone = true
        break
      }
    } catch (err) {
      console.warn(`Error registering comment ${accel}`, err)
    }
  }
  if (!commentDone) {
    console.warn('Failed to register comment/segment shortcut')
    ok = false
  }

  if (onRecover) {
    let recoverDone = false
    for (const accel of RECOVER_ACCELS) {
      try {
        const recoverOk = globalShortcut.register(accel, () => {
          onRecover()
        })
        if (recoverOk) {
          registered.push(accel)
          recoverDone = true
          break
        }
      } catch (err) {
        console.warn(`Error registering recover ${accel}`, err)
      }
    }
    if (!recoverDone) {
      console.warn('Failed to register recover UI shortcut')
    }
  }

  if (ok) {
    console.log('Global shortcuts registered:', registered.join(', '))
  } else {
    console.warn(
      'Some global shortcuts failed. Another app (or a leftover WhatWhen process) may own them. Registered:',
      registered
    )
  }

  service.hotkeysOk = ok
  return ok
}

/** Retry a few times — helps when a previous instance is still releasing hooks. */
export async function registerShortcutsWithRetry(
  service: SessionService,
  onAfter: () => void,
  attempts = 4,
  delayMs = 400,
  onRecover?: () => void
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (registerShortcuts(service, onAfter, onRecover)) return true
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  return false
}

export function unregisterShortcuts(): void {
  if (!app.isReady()) return
  try {
    globalShortcut.unregisterAll()
  } catch (err) {
    console.warn('unregisterShortcuts failed', err)
  }
}
