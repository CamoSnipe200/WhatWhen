import './style.css'
import type {
  DayAnalysis,
  Profile,
  ProfileSlot,
  Session,
  UiSnapshot
} from '../../shared/types'
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
const bubbleHint = document.getElementById('bubble-hint') as HTMLDivElement
const settingsEl = document.getElementById('settings') as HTMLDivElement
const settingsList = document.getElementById('settings-list') as HTMLDivElement
const settingsDone = document.getElementById('settings-done') as HTMLButtonElement
const liveTimer = document.getElementById('live-timer') as HTMLDivElement
const analysisEl = document.getElementById('analysis') as HTMLDivElement
const analysisBody = document.getElementById('analysis-body') as HTMLDivElement
const analysisNotes = document.getElementById('analysis-notes') as HTMLDivElement
const analysisClose = document.getElementById('analysis-close') as HTMLButtonElement
const timelineEl = document.getElementById('timeline') as HTMLDivElement
const timelineTrack = document.getElementById('timeline-track') as HTMLDivElement
const timelineHover = document.getElementById('timeline-hover') as HTMLDivElement
const timelineClose = document.getElementById('timeline-close') as HTMLButtonElement

let state: UiSnapshot | null = null
let editingId: string | null = null
let draftProfiles: Profile[] | null = null
let wheelBuilt = false

/** Orb drag state */
let dragging = false
let dragMoved = false
let dragLastX = 0
let dragLastY = 0
let dragAnchor: { x: number; y: number } | null = null
const DRAG_THRESHOLD = 4

function defaultName(slot: ProfileSlot): string {
  return `Profile ${SLOT_DISPLAY[slot]}`
}

/** Clock-style elapsed that always ticks seconds (shown inside the orb). */
function formatLiveElapsed(ms: number): string {
  if (ms < 0) ms = 0
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * White elapsed digits inside the orb — only while the wheel is open
 * (orb clicked) and a timer is running. Hidden when idle / closed.
 */
function updateLiveTimer(snap: UiSnapshot): void {
  const running = !!snap.activeSession && !snap.activeSession.endIso
  const show = running && snap.mode === 'wheel'

  if (show) {
    const label = formatLiveElapsed(snap.elapsedMs)
    liveTimer.textContent = label
    liveTimer.classList.toggle('long', label.length > 5)
    liveTimer.setAttribute('aria-hidden', 'false')
    if (!liveTimer.classList.contains('visible')) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => liveTimer.classList.add('visible'))
      })
    }
  } else {
    liveTimer.classList.remove('visible')
    liveTimer.classList.remove('long')
    liveTimer.textContent = ''
    liveTimer.setAttribute('aria-hidden', 'true')
  }
}

/**
 * Smart state apply: elapsed ticks only refresh the orb + live timer —
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
  updateLiveTimer(snap)

  // After toggling idle/wheel/stack the cursor is usually still over the orb —
  // re-enable hit-testing without requiring a mouse move (fixes dead clicks).
  if (snap.mode === 'idle' || snap.mode === 'wheel' || snap.mode === 'stack') {
    window.whatwhen.setIgnoreMouse(false)
  }

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

  if (!modeChanged && snap.mode === 'analysis') {
    // Refresh only when totals change (avoid hover flicker on 1s ticks)
    const prevTracked = prev?.analysis?.trackedMs
    const nextTracked = snap.analysis?.trackedMs
    const prevN = prev?.todaySessions?.length
    const nextN = snap.todaySessions?.length
    if (prevTracked !== nextTracked || prevN !== nextN) {
      renderAnalysis(snap.analysis)
    }
    return
  }

  if (!modeChanged && snap.mode === 'timeline') {
    const prevN = prev?.todaySessions?.length
    const nextN = snap.todaySessions?.length
    const prevEnd = prev?.todaySessions?.map((s) => s.endIso).join('|')
    const nextEnd = snap.todaySessions.map((s) => s.endIso).join('|')
    if (prevN !== nextN || prevEnd !== nextEnd) {
      renderTimeline(snap.todaySessions)
    }
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
    showBubble(snap.bubbleSession, snap.bubbleFromBacklog)
  } else if (snap.mode === 'settings') {
    showSettings(snap.profiles)
  } else if (snap.mode === 'analysis') {
    showAnalysis(snap.analysis)
  } else if (snap.mode === 'timeline') {
    showTimeline(snap.todaySessions)
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
  if (nextMode !== 'analysis') {
    analysisEl.hidden = true
    analysisNotes.hidden = true
    analysisBody.innerHTML = ''
  }
  if (nextMode !== 'timeline') {
    timelineEl.hidden = true
    timelineHover.hidden = true
    timelineTrack.innerHTML = ''
  }

  // Keep the orb available while centered Analysis / Timeline overlays are open.
  orb.hidden = false
}

function stripNativeTips(root: ParentNode = document): void {
  root.querySelectorAll('[title]').forEach((el) => el.removeAttribute('title'))
}

function renderOrb(snap: UiSnapshot): void {
  // Never set title / aria-label — Windows shows a white native tooltip for those
  orb.removeAttribute('title')
  orb.removeAttribute('aria-label')

  if (snap.activeSession && !snap.activeSession.endIso) {
    orb.classList.add('active')
    orbTint.style.background = snap.activeSession.profileColor
  } else {
    orb.classList.remove('active')
    orbTint.style.background = 'transparent'
  }

  const n = snap.pending.length
  if (n > 0) {
    orbBadge.hidden = false
    orbBadge.textContent = String(n)
    orbBadge.classList.add('pending')
  } else {
    orbBadge.hidden = true
    orbBadge.classList.remove('pending')
  }
  stripNativeTips()
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

  visible.forEach((session) => {
    const dot = document.createElement('button')
    dot.type = 'button'
    dot.className = 'stack-dot'
    dot.style.setProperty('--dot-color', session.profileColor)
    dot.addEventListener('click', (e) => {
      e.stopPropagation()
      void window.whatwhen.openBubble(session.id)
    })
    stackEl.appendChild(dot)
  })
}

function showBubble(session: Session, fromBacklog = false): void {
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
  bubbleHint.textContent = fromBacklog
    ? 'Enter to save · Esc dismisses'
    : 'Enter to save · Esc keeps pending if empty'
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

// —— Analysis ——
function showAnalysis(analysis: DayAnalysis | null): void {
  analysisEl.hidden = false
  renderAnalysis(analysis)
}

function renderAnalysis(analysis: DayAnalysis | null): void {
  analysisBody.innerHTML = ''
  analysisNotes.hidden = true

  if (!analysis || analysis.slices.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'overlay-empty'
    empty.textContent = 'No sessions yet today.'
    analysisBody.appendChild(empty)
    return
  }

  const summary = document.createElement('div')
  summary.className = 'analysis-summary'
  summary.textContent = `Recorded ${formatDuration(analysis.trackedMs)}`
  analysisBody.appendChild(summary)

  const charts = document.createElement('div')
  charts.className = 'analysis-charts'

  const pieWrap = document.createElement('div')
  pieWrap.className = 'pie-wrap'
  pieWrap.appendChild(buildPieSvg(analysis))
  charts.appendChild(pieWrap)

  const bars = document.createElement('div')
  bars.className = 'bar-list'
  for (const slice of analysis.slices) {
    const row = document.createElement('div')
    row.className = 'bar-row'
    row.dataset.slice = slice.profileName

    const label = document.createElement('div')
    label.className = 'bar-label'
    const sw = document.createElement('span')
    sw.className = 'bar-swatch'
    sw.style.background = slice.profileColor
    const name = document.createElement('span')
    name.textContent = slice.profileName
    label.append(sw, name)

    const track = document.createElement('div')
    track.className = 'bar-track'
    const fill = document.createElement('div')
    fill.className = 'bar-fill'
    fill.style.width = `${Math.max(2, slice.percentOfTracked)}%`
    fill.style.background = slice.profileColor
    track.appendChild(fill)

    const pct = document.createElement('div')
    pct.className = 'bar-pct'
    pct.textContent = `${slice.percentOfTracked.toFixed(0)}%`

    row.append(label, track, pct)

    const showNotes = (): void => {
      if (slice.notes.length === 0) {
        analysisNotes.hidden = true
        return
      }
      analysisNotes.hidden = false
      analysisNotes.innerHTML = ''
      const head = document.createElement('div')
      head.className = 'analysis-notes-title'
      head.textContent = slice.profileName
      analysisNotes.appendChild(head)
      const list = document.createElement('ul')
      list.className = 'analysis-notes-list'
      for (const n of slice.notes) {
        const li = document.createElement('li')
        li.textContent = n
        list.appendChild(li)
      }
      analysisNotes.appendChild(list)
    }
    const hideNotes = (): void => {
      analysisNotes.hidden = true
    }
    row.addEventListener('mouseenter', showNotes)
    row.addEventListener('mouseleave', hideNotes)

    bars.appendChild(row)
  }
  charts.appendChild(bars)
  analysisBody.appendChild(charts)
}

function buildPieSvg(analysis: DayAnalysis): SVGSVGElement {
  const size = 160
  const cx = size / 2
  const cy = size / 2
  const r = 68
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.classList.add('pie-chart')

  let angle = -Math.PI / 2
  const total = analysis.trackedMs || 1

  for (const slice of analysis.slices) {
    const sweep = (slice.durationMs / total) * Math.PI * 2
    if (sweep <= 0) continue
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    const x1 = cx + r * Math.cos(angle)
    const y1 = cy + r * Math.sin(angle)
    const end = angle + sweep
    const x2 = cx + r * Math.cos(end)
    const y2 = cy + r * Math.sin(end)
    const large = sweep > Math.PI ? 1 : 0
    path.setAttribute(
      'd',
      `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
    )
    path.setAttribute('fill', slice.profileColor)
    path.setAttribute('opacity', '0.88')
    path.setAttribute('stroke', 'rgba(0,0,0,0.25)')
    path.setAttribute('stroke-width', '1')

    path.addEventListener('mouseenter', () => {
      if (slice.notes.length === 0) {
        analysisNotes.hidden = true
        return
      }
      analysisNotes.hidden = false
      analysisNotes.innerHTML = ''
      const head = document.createElement('div')
      head.className = 'analysis-notes-title'
      head.textContent = slice.profileName
      analysisNotes.appendChild(head)
      const list = document.createElement('ul')
      list.className = 'analysis-notes-list'
      for (const n of slice.notes) {
        const li = document.createElement('li')
        li.textContent = n
        list.appendChild(li)
      }
      analysisNotes.appendChild(list)
    })
    path.addEventListener('mouseleave', () => {
      analysisNotes.hidden = true
    })

    svg.appendChild(path)
    angle = end
  }

  return svg
}

// —— Timeline ——
function showTimeline(sessions: Session[]): void {
  timelineEl.hidden = false
  renderTimeline(sessions)
}

function renderTimeline(sessions: Session[]): void {
  timelineTrack.innerHTML = ''
  timelineHover.hidden = true

  if (sessions.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'overlay-empty'
    empty.textContent = 'No sessions yet today.'
    timelineTrack.appendChild(empty)
    return
  }

  const now = Date.now()
  const starts = sessions.map((s) => new Date(s.startIso).getTime())
  const ends = sessions.map((s) =>
    s.endIso ? new Date(s.endIso).getTime() : now
  )
  const minT = Math.min(...starts)
  const maxT = Math.max(...ends, minT + 1)
  const span = Math.max(maxT - minT, 60_000)
  // ~120px per hour, min width for scroll
  const pxPerMs = 120 / (60 * 60 * 1000)
  const trackW = Math.max(640, span * pxPerMs + 80)
  timelineTrack.style.width = `${trackW}px`

  const rail = document.createElement('div')
  rail.className = 'timeline-rail'
  timelineTrack.appendChild(rail)

  sessions.forEach((session, i) => {
    const s = new Date(session.startIso).getTime()
    const e = session.endIso ? new Date(session.endIso).getTime() : now
    const left = ((s - minT) / span) * (trackW - 40) + 20
    const width = Math.max(28, ((e - s) / span) * (trackW - 40))

    const bubble = document.createElement('button')
    bubble.type = 'button'
    bubble.className = 'timeline-bubble'
    bubble.style.left = `${left}px`
    bubble.style.width = `${width}px`
    bubble.style.setProperty('--c', session.profileColor)
    bubble.style.animationDelay = `${i * 30}ms`

    const bar = document.createElement('span')
    bar.className = 'timeline-bar'

    const label = document.createElement('span')
    label.className = 'timeline-label'

    const time = document.createElement('span')
    time.className = 'timeline-time'
    time.textContent = formatTimeLocal(session.startIso)

    const name = document.createElement('span')
    name.className = 'timeline-name'
    name.textContent = session.profileName

    label.append(time, name)
    bubble.append(bar, label)

    bubble.addEventListener('mouseenter', () => {
      timelineHover.hidden = false
      const note = session.notes.trim()
        ? session.notes.trim()
        : session.notesStatus === 'pending'
          ? '(pending notes)'
          : session.endIso
            ? '(no notes)'
            : '(in progress)'
      const endLabel = session.endIso ? formatTimeLocal(session.endIso) : '…'
      timelineHover.innerHTML = ''
      const h = document.createElement('div')
      h.className = 'timeline-hover-title'
      h.textContent = `${session.profileName} · ${formatTimeLocal(session.startIso)} – ${endLabel}`
      const body = document.createElement('div')
      body.className = 'timeline-hover-note'
      body.textContent = note
      timelineHover.append(h, body)
    })
    bubble.addEventListener('mouseleave', () => {
      timelineHover.hidden = true
    })

    timelineTrack.appendChild(bubble)
  })
}

/**
 * Idle/wheel/stack use a large transparent HWND with pass-through on empty
 * glass. Interactive nodes temporarily disable pass-through while hovered.
 * Bubble / settings / overlays: main process owns mouse policy.
 */
function needsPassThrough(): boolean {
  const mode = state?.mode
  return mode === 'idle' || mode === 'wheel' || mode === 'stack'
}

function wireHit(el: HTMLElement): void {
  el.addEventListener('mouseenter', () => {
    if (needsPassThrough()) window.whatwhen.setIgnoreMouse(false)
  })
  el.addEventListener('mouseleave', () => {
    if (needsPassThrough()) window.whatwhen.setIgnoreMouse(true)
  })
}
wireHit(orb)
wireHit(wheelEl)
wireHit(stackEl)
wireHit(bubbleEl)
wireHit(settingsEl)
wireHit(analysisEl)
wireHit(timelineEl)

// —— Orb drag (click-and-hold move) ——
orb.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  if (state?.mode !== 'idle') return
  dragging = true
  dragMoved = false
  dragLastX = e.screenX
  dragLastY = e.screenY
  dragAnchor = null
  orb.setPointerCapture(e.pointerId)
})

orb.addEventListener('pointermove', (e) => {
  if (!dragging) return
  const dx = e.screenX - dragLastX
  const dy = e.screenY - dragLastY
  if (!dragMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
  dragMoved = true
  dragLastX = e.screenX
  dragLastY = e.screenY
  void window.whatwhen.dragOrb(dx, dy).then((anchor) => {
    dragAnchor = anchor
  })
})

function endDrag(e: PointerEvent): void {
  if (!dragging) return
  dragging = false
  try {
    orb.releasePointerCapture(e.pointerId)
  } catch {
    /* already released */
  }
  if (dragMoved && dragAnchor) {
    void window.whatwhen.endOrbDrag(dragAnchor)
  }
}

orb.addEventListener('pointerup', endDrag)
orb.addEventListener('pointercancel', endDrag)

// —— Events ——
orb.addEventListener('click', (e) => {
  e.stopPropagation()
  if (dragMoved) {
    dragMoved = false
    return
  }
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

analysisClose.addEventListener('click', () => {
  void window.whatwhen.closeUi()
})

timelineClose.addEventListener('click', () => {
  void window.whatwhen.closeUi()
})

/** Enter / orb click: save (empty clears pending as intentional blank). */
async function leaveBubbleSaving(): Promise<void> {
  const text = bubbleInput.value
  const id = editingId
  if (id) {
    await window.whatwhen.saveNotes(id, text)
  } else {
    await window.whatwhen.dismissBubble(text)
  }
}

/**
 * Escape: empty draft —
 * - Fresh switch/stop note → leave UI, keep pending badge
 * - Backlog pending note → dismiss so it leaves the queue
 * With text → save and clear pending.
 */
async function leaveBubbleEscape(): Promise<void> {
  const text = bubbleInput.value
  if (text.trim()) {
    await leaveBubbleSaving()
  } else {
    await window.whatwhen.bubbleEscape()
  }
}

bubbleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void leaveBubbleSaving()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    void leaveBubbleEscape()
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
    void leaveBubbleEscape()
  } else if (
    state.mode === 'stack' ||
    state.mode === 'wheel' ||
    state.mode === 'analysis' ||
    state.mode === 'timeline'
  ) {
    void window.whatwhen.closeUi()
  } else if (state.mode === 'settings') {
    void saveSettingsAndClose()
  }
})

async function boot(): Promise<void> {
  document.title = ''
  stripNativeTips()
  // Keep stripping if anything re-adds title (Chromium / a11y)
  const mo = new MutationObserver(() => stripNativeTips())
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['title'],
    subtree: true
  })

  const snap = await window.whatwhen.getState()
  applyState(snap)
  window.whatwhen.onStateChanged(applyState)
}

void boot()
