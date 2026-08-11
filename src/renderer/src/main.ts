import './style.css'
import type { Profile, ProfileSlot, Session, UiSnapshot } from '../../shared/types'
import { SLOT_DISPLAY, formatDuration, formatTimeLocal } from '../../shared/types'

const MAX_VISIBLE = 7

const orb = document.getElementById('orb') as HTMLButtonElement
const orbTint = document.getElementById('orb-tint') as HTMLSpanElement
const orbBadge = document.getElementById('orb-badge') as HTMLSpanElement
const wheelEl = document.getElementById('wheel') as HTMLDivElement
const stackEl = document.getElementById('stack') as HTMLDivElement
const bubbleEl = document.getElementById('bubble') as HTMLDivElement
const bubbleInput = document.getElementById('bubble-input') as HTMLTextAreaElement
const bubbleTitle = document.getElementById('bubble-title') as HTMLDivElement
const bubbleRange = document.getElementById('bubble-range') as HTMLDivElement
const bubbleSwatch = document.getElementById('bubble-swatch') as HTMLSpanElement
const settingsEl = document.getElementById('settings') as HTMLDivElement
const settingsList = document.getElementById('settings-list') as HTMLDivElement
const settingsDone = document.getElementById('settings-done') as HTMLButtonElement

let state: UiSnapshot | null = null
let editingId: string | null = null
let draftProfiles: Profile[] | null = null
let wheelBuilt = false

function defaultName(slot: ProfileSlot): string {
  return `Profile ${SLOT_DISPLAY[slot]}`
}

/**
 * Smart state apply: elapsed ticks only refresh the orb —
 * never rebuild the radial wheel (was flashing every second).
 */
function applyState(snap: UiSnapshot): void {
  const prev = state
  const modeChanged = !prev || prev.mode !== snap.mode
  const profilesChanged =
    !prev ||
    JSON.stringify(prev.profiles) !== JSON.stringify(snap.profiles) ||
    prev.activeSession?.profileSlot !== snap.activeSession?.profileSlot

  state = snap
  renderOrb(snap)

  if (!modeChanged && snap.mode === 'wheel' && wheelBuilt && !profilesChanged) {
    updateWheelActive(snap)
    return
  }

  if (!modeChanged && snap.mode === 'bubble' && editingId === snap.bubbleSession?.id) {
    // keep typing; only range is static after end
    return
  }

  if (!modeChanged && snap.mode === 'settings' && draftProfiles) {
    return
  }

  if (modeChanged || !wheelBuilt || profilesChanged) {
    hideAllOverlays(snap.mode)
  }

  if (snap.mode === 'wheel') {
    renderWheel(snap)
  } else if (snap.mode === 'stack') {
    renderStack(snap.pending)
  } else if (snap.mode === 'bubble' && snap.bubbleSession) {
    showBubble(snap.bubbleSession)
  } else if (snap.mode === 'settings') {
    showSettings(snap.profiles)
  }
}

function hideAllOverlays(nextMode: UiSnapshot['mode']): void {
  if (nextMode !== 'wheel') {
    wheelEl.hidden = true
    wheelEl.innerHTML = ''
    wheelBuilt = false
  }
  if (nextMode !== 'stack') {
    stackEl.hidden = true
    stackEl.innerHTML = ''
  }
  if (nextMode !== 'bubble') {
    bubbleEl.hidden = true
    editingId = null
  }
  if (nextMode !== 'settings') {
    settingsEl.hidden = true
    draftProfiles = null
  }
}

function renderOrb(snap: UiSnapshot): void {
  orb.removeAttribute('title')

  if (snap.activeSession && !snap.activeSession.endIso) {
    orb.classList.add('active')
    orbTint.style.background = snap.activeSession.profileColor
    orb.setAttribute('aria-label', snap.activeSession.profileName)
  } else {
    orb.classList.remove('active')
    orbTint.style.background = 'transparent'
    orb.setAttribute('aria-label', 'Open profiles')
  }

  const n = snap.pending.length
  if (n > 0) {
    orbBadge.hidden = false
    orbBadge.textContent = String(n)
  } else {
    orbBadge.hidden = true
  }
}

/**
 * Inner ring: same spacing as before — t = 0, 0.4, 0.8 → 5, 6, ×
 * Outer ring: 1–4 on outer radius, packed into that same angular span
 * (no wide 0…1/3…2/3…1 stretch).
 */
function renderWheel(snap: UiSnapshot): void {
  wheelEl.hidden = false
  wheelEl.innerHTML = ''
  wheelBuilt = true

  const ORB = 52
  const DOT = 38
  const half = DOT / 2
  const originRight = 4 + ORB / 2
  const originBottom = 4 + ORB / 2

  const innerR = 82
  const outerR = innerR + DOT + 4
  const startDeg = 105
  const endDeg = 190
  const span = endDeg - startDeg

  // Inner spacing locked (was 4/5/6, now 5/6/×)
  const innerTs = [0.0, 0.4, 0.8] as const
  // Outer 1–4 evenly within that same span (0 → 0.8), not the full fan
  const outerTs = [0.0, 0.8 / 3, (0.8 * 2) / 3, 0.8] as const

  const profiles = [...snap.profiles].sort((a, b) => a.slot - b.slot)
  const bySlot = (s: number): Profile =>
    profiles.find((p) => p.slot === s) ?? {
      slot: s as ProfileSlot,
      name: `Profile ${s}`,
      color: '#888'
    }

  type WheelItem =
    | { kind: 'profile'; profile: Profile; radius: number; t: number }
    | { kind: 'stop'; radius: number; t: number }

  const items: WheelItem[] = [
    { kind: 'profile', profile: bySlot(1), radius: outerR, t: outerTs[0] },
    { kind: 'profile', profile: bySlot(2), radius: outerR, t: outerTs[1] },
    { kind: 'profile', profile: bySlot(3), radius: outerR, t: outerTs[2] },
    { kind: 'profile', profile: bySlot(4), radius: outerR, t: outerTs[3] },
    { kind: 'profile', profile: bySlot(5), radius: innerR, t: innerTs[0] },
    { kind: 'profile', profile: bySlot(6), radius: innerR, t: innerTs[1] },
    { kind: 'stop', radius: innerR, t: innerTs[2] }
  ]

  const activeSlot = snap.activeSession?.endIso
    ? undefined
    : snap.activeSession?.profileSlot

  items.forEach((item, i) => {
    const deg = startDeg + item.t * span
    const rad = (deg * Math.PI) / 180
    const right = originRight - Math.cos(rad) * item.radius - half
    const bottom = originBottom + Math.sin(rad) * item.radius - half

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'wheel-dot'
    btn.style.width = `${DOT}px`
    btn.style.height = `${DOT}px`
    btn.style.right = `${right}px`
    btn.style.bottom = `${bottom}px`
    btn.style.left = 'auto'
    btn.style.top = 'auto'
    btn.style.animationDelay = `${i * 28}ms`

    const num = document.createElement('span')
    num.className = 'slot-num'

    if (item.kind === 'stop') {
      btn.classList.add('stop')
      btn.dataset.stop = '1'
      btn.setAttribute('aria-label', 'Stop timer')
      num.textContent = '×'
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        void window.whatwhen.stop()
      })
    } else {
      const { profile } = item
      btn.dataset.slot = String(profile.slot)
      if (profile.slot === activeSlot) btn.classList.add('active-slot')
      btn.style.setProperty('--c', profile.color)
      btn.setAttribute(
        'aria-label',
        `${profile.name} (${SLOT_DISPLAY[profile.slot]})`
      )
      num.textContent = SLOT_DISPLAY[profile.slot]
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        void window.whatwhen.switchProfile(profile.slot as ProfileSlot)
      })
    }

    btn.appendChild(num)
    wheelEl.appendChild(btn)
  })
}

function updateWheelActive(snap: UiSnapshot): void {
  const activeSlot = snap.activeSession?.endIso
    ? undefined
    : snap.activeSession?.profileSlot
  wheelEl.querySelectorAll('.wheel-dot').forEach((el) => {
    const btn = el as HTMLElement
    if (btn.dataset.stop) {
      btn.classList.remove('active-slot')
      return
    }
    const slot = Number(btn.dataset.slot)
    btn.classList.toggle('active-slot', slot === activeSlot)
  })
}

function renderStack(pending: Session[]): void {
  stackEl.hidden = false
  stackEl.innerHTML = ''

  if (pending.length === 0) {
    void window.whatwhen.closeUi()
    return
  }

  const visible =
    pending.length > MAX_VISIBLE ? pending.slice(pending.length - MAX_VISIBLE) : pending

  visible.forEach((session, i) => {
    const dot = document.createElement('button')
    dot.type = 'button'
    dot.className = 'stack-dot'
    dot.style.setProperty('--dot-color', session.profileColor)
    dot.style.animationDelay = `${i * 40}ms`
    const start = formatTimeLocal(session.startIso)
    const end = session.endIso ? formatTimeLocal(session.endIso) : '…'
    dot.setAttribute('aria-label', `${session.profileName} · ${start} – ${end}`)
    dot.addEventListener('click', (e) => {
      e.stopPropagation()
      void window.whatwhen.openBubble(session.id)
    })
    stackEl.appendChild(dot)
  })
}

function showBubble(session: Session): void {
  bubbleEl.hidden = false
  const isNew = editingId !== session.id
  editingId = session.id
  bubbleTitle.textContent = session.profileName
  bubbleSwatch.style.background = session.profileColor
  const start = formatTimeLocal(session.startIso)
  const end = session.endIso ? formatTimeLocal(session.endIso) : '…'
  const ms = session.endIso
    ? new Date(session.endIso).getTime() - new Date(session.startIso).getTime()
    : 0
  bubbleRange.textContent = `${start} – ${end} · ${formatDuration(ms)}`
  if (isNew) {
    bubbleInput.value = session.notes || ''
    requestAnimationFrame(() => bubbleInput.focus())
  }
}

function showSettings(profiles: Profile[]): void {
  settingsEl.hidden = false
  if (!draftProfiles) {
    draftProfiles = profiles.map((p) => ({ ...p }))
  }
  renderSettingsList()
}

function renderSettingsList(): void {
  if (!draftProfiles) return
  settingsList.innerHTML = ''
  const ordered = [...draftProfiles].sort((a, b) => {
    const av = a.slot === 0 ? 10 : a.slot
    const bv = b.slot === 0 ? 10 : b.slot
    return av - bv
  })

  for (const profile of ordered) {
    const row = document.createElement('div')
    row.className = 'settings-row'

    const slot = document.createElement('span')
    slot.className = 'slot-label'
    slot.textContent = SLOT_DISPLAY[profile.slot]

    const color = document.createElement('input')
    color.type = 'color'
    color.value = normalizeHex(profile.color)
    color.addEventListener('input', () => {
      profile.color = color.value
      const target = draftProfiles!.find((p) => p.slot === profile.slot)
      if (target) target.color = color.value
    })

    const name = document.createElement('input')
    name.type = 'text'
    name.value = profile.name
    name.maxLength = 40
    name.placeholder = defaultName(profile.slot)
    name.addEventListener('input', () => {
      profile.name = name.value
      const target = draftProfiles!.find((p) => p.slot === profile.slot)
      if (target) target.name = name.value
    })

    row.append(slot, color, name)
    settingsList.appendChild(row)
  }
}

function normalizeHex(c: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c
  return '#888888'
}

async function saveSettingsAndClose(): Promise<void> {
  if (draftProfiles) {
    const cleaned = draftProfiles.map((p) => ({
      ...p,
      name: p.name.trim() || defaultName(p.slot)
    }))
    await window.whatwhen.updateProfiles(cleaned)
  }
  draftProfiles = null
  await window.whatwhen.closeUi()
}

// —— Hit testing ——
function wireHit(el: HTMLElement): void {
  el.addEventListener('mouseenter', () => window.whatwhen.setIgnoreMouse(false))
  el.addEventListener('mouseleave', () => {
    if (state && state.mode !== 'idle') return
    window.whatwhen.setIgnoreMouse(true)
  })
}
wireHit(orb)
wireHit(wheelEl)
wireHit(stackEl)
wireHit(bubbleEl)
wireHit(settingsEl)

// —— Events ——
orb.addEventListener('click', (e) => {
  e.stopPropagation()
  if (state?.mode === 'bubble') {
    void leaveBubbleSaving()
    return
  }
  void window.whatwhen.toggleWheel()
})

orbBadge.addEventListener('click', (e) => {
  e.stopPropagation()
  e.preventDefault()
  void window.whatwhen.openStack()
})

orb.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  void window.whatwhen.showContextMenu()
})

settingsDone.addEventListener('click', () => {
  void saveSettingsAndClose()
})

async function leaveBubbleSaving(): Promise<void> {
  const text = bubbleInput.value
  const id = editingId
  if (id) {
    await window.whatwhen.saveNotes(id, text)
  } else {
    await window.whatwhen.bubbleEscape(text)
  }
}

bubbleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void leaveBubbleSaving()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    // Leaving still saves (default save)
    void leaveBubbleSaving()
  }
})

// Blur / leaving the bubble also saves
bubbleInput.addEventListener('blur', () => {
  // Delay so clicks inside bubble don't fire first
  setTimeout(() => {
    if (state?.mode === 'bubble' && document.activeElement !== bubbleInput) {
      // only if still in bubble mode and focus left the window chrome
    }
  }, 0)
})

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !state) return
  if (state.mode === 'bubble') {
    void leaveBubbleSaving()
  } else if (state.mode === 'stack' || state.mode === 'wheel') {
    void window.whatwhen.closeUi()
  } else if (state.mode === 'settings') {
    void saveSettingsAndClose()
  }
})

async function boot(): Promise<void> {
  const snap = await window.whatwhen.getState()
  applyState(snap)
  window.whatwhen.onStateChanged(applyState)
}

void boot()
