import './style.css'
import type {
  DayAnalysis,
  Profile,
  ProfileSlice,
  ProfileSlot,
  Session,
  UiSnapshot
} from '../../shared/types'
import { SLOT_DISPLAY, formatDuration, formatTimeLocal } from '../../shared/types'
import { placeOnArc, type RadialArc } from './radial-arc'

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
const timelineInspector = document.getElementById('timeline-inspector') as HTMLDivElement
const timelineClose = document.getElementById('timeline-close') as HTMLButtonElement

let state: UiSnapshot | null = null
let editingId: string | null = null
let draftProfiles: Profile[] | null = null
let wheelBuilt = false
let selectedTimelineId: string | null = null
let splitAtIso: string | null = null
let hoveredSliceKey: string | null = null
let analysisSig = ''
let analysisRebuildPending = false
let notesHideTimer: number | null = null

const STOP_HOLD_MS = 700
let stopHold: number | null = null
let stopHoldFired = false

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

  // After toggling wheel/stack the cursor is usually still over the orb —
  // re-enable hit-testing without requiring a mouse move (fixes dead clicks).
  // Only on mode change — elapsed ticks must not disable pass-through over
  // empty wheel/stack glass (that steals scroll from apps underneath).
  if (
    modeChanged &&
    (snap.mode === 'idle' || snap.mode === 'wheel' || snap.mode === 'stack')
  ) {
    window.whatwhen.setIgnoreMouse(false)
  }

  if (!modeChanged && snap.mode === 'wheel' && wheelBuilt && !profilesChanged) {
    updateWheelActive(snap)
    const prevPending = prev?.pending.map((p) => p.id).join('|')
    const nextPending = snap.pending.map((p) => p.id).join('|')
    if (prevPending !== nextPending) renderPendingOnWheel(snap.pending)
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
    const sig = analysisSignature(snap.analysis)
    if (sig !== analysisSig) {
      if (hoveredSliceKey !== null) {
        analysisRebuildPending = true
      } else {
        renderAnalysis(snap.analysis)
      }
    } else if (hoveredSliceKey === null) {
      updateAnalysisLive(snap.analysis)
    }
    return
  }

  if (!modeChanged && snap.mode === 'timeline') {
    const prevN = prev?.todaySessions?.length
    const nextN = snap.todaySessions?.length
    const prevSig = prev?.todaySessions
      ?.map((s) => `${s.id}:${s.startIso}:${s.endIso}:${s.profileSlot}:${s.profileColor}`)
      .join('|')
    const nextSig = snap.todaySessions
      .map((s) => `${s.id}:${s.startIso}:${s.endIso}:${s.profileSlot}:${s.profileColor}`)
      .join('|')
    if (prevN !== nextN || prevSig !== nextSig) {
      renderTimeline(snap.todaySessions)
    }
    return
  }

  if (modeChanged || !wheelBuilt || profilesChanged) {
    hideAllOverlays(snap.mode)
  }

  if (snap.mode === 'wheel') {
    renderWheel(snap)
    renderPendingOnWheel(snap.pending)
  } else if (snap.mode === 'stack') {
    stackEl.classList.remove('above-wheel')
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
  cancelStopHold()
  if (nextMode !== 'wheel') {
    fadeOutChrome(wheelEl, () => {
      wheelEl.innerHTML = ''
      wheelBuilt = false
    })
  } else {
    wheelEl.classList.remove('is-leaving')
  }
  if (nextMode !== 'stack' && nextMode !== 'wheel') {
    fadeOutChrome(stackEl, () => {
      stackEl.innerHTML = ''
      stackEl.classList.remove('above-wheel')
    })
  } else {
    stackEl.classList.remove('is-leaving')
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
    if (notesHideTimer !== null) {
      window.clearTimeout(notesHideTimer)
      notesHideTimer = null
    }
    hoveredSliceKey = null
    analysisSig = ''
    analysisRebuildPending = false
    analysisEl.hidden = true
    analysisNotes.hidden = true
    analysisBody.innerHTML = ''
  }
  if (nextMode !== 'timeline') {
    timelineEl.hidden = true
    timelineHover.hidden = true
    timelineInspector.hidden = true
    timelineEl.classList.remove('is-inspecting')
    timelineTrack.innerHTML = ''
    selectedTimelineId = null
    splitAtIso = null
    void window.whatwhen.setTimelineEditing(false)
  }

  // Keep the orb available while centered Analysis / Timeline overlays are open.
  orb.hidden = false
}

/** Fade wheel/stack out so the orb can stay visible while the HWND shrinks. */
function fadeOutChrome(el: HTMLElement, after: () => void): void {
  if (el.hidden) {
    after()
    return
  }
  el.classList.add('is-leaving')
  window.setTimeout(() => {
    el.hidden = true
    el.classList.remove('is-leaving')
    after()
  }, 120)
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
 * Dual-ring wheel. Each ring is startDeg → endDeg at a radius; items pack
 * evenly unless spacingDeg is set. 90 = up from the orb, 180 = left of it.
 */
function cancelStopHold(): void {
  if (stopHold !== null) {
    window.clearTimeout(stopHold)
    stopHold = null
  }
  wheelEl.querySelector('.wheel-dot.stop')?.classList.remove('is-holding')
}

function beginStopHold(btn: HTMLElement): void {
  cancelStopHold()
  btn.classList.add('is-holding')
  stopHold = window.setTimeout(() => {
    stopHold = null
    if (!state?.activeSession || state.activeSession.endIso) {
      cancelStopHold()
      return
    }
    stopHoldFired = true
    cancelStopHold()
    void window.whatwhen.discardActive()
  }, STOP_HOLD_MS)
}

function renderWheel(snap: UiSnapshot): void {
  cancelStopHold()
  wheelEl.hidden = false
  wheelEl.innerHTML = ''
  wheelBuilt = true

  const ORB = 52
  const DOT = 38
  const origin = { right: 2 + ORB / 2, bottom: 2 + ORB / 2 }

  // Lowest (~184°) sits on the orb's bottom edge; highest (~96°) hugs the
  // right/up side of the window. Wider span than 105–173 opens the gaps.
  const inner: RadialArc = { radius: 82, startDeg: 96, endDeg: 184 }
  const outer: RadialArc = {
    radius: inner.radius + DOT + 4,
    startDeg: 102,
    endDeg: 176
  }

  const profiles = [...snap.profiles].sort((a, b) => a.slot - b.slot)
  const bySlot = (s: number): Profile =>
    profiles.find((p) => p.slot === s) ?? {
      slot: s as ProfileSlot,
      name: `Profile ${s}`,
      color: '#888'
    }

  const outerSlots = [1, 2, 3, 4].map(bySlot)
  const innerSlots = [5, 6, 7]
  const outerPos = placeOnArc(outerSlots.length, outer, origin, DOT)
  const innerPos = placeOnArc(innerSlots.length + 1, inner, origin, DOT)

  type Placed =
    | { kind: 'profile'; profile: Profile; pos: (typeof outerPos)[number] }
    | { kind: 'stop'; pos: (typeof innerPos)[number] }

  const items: Placed[] = [
    ...outerSlots.map((profile, i) => ({
      kind: 'profile' as const,
      profile,
      pos: outerPos[i]
    })),
    ...innerSlots.map((slot, i) => ({
      kind: 'profile' as const,
      profile: bySlot(slot),
      pos: innerPos[i]
    })),
    { kind: 'stop', pos: innerPos[innerSlots.length] }
  ]

  const activeSlot = snap.activeSession?.endIso
    ? undefined
    : snap.activeSession?.profileSlot

  items.forEach((item, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'wheel-dot'
    btn.style.width = `${DOT}px`
    btn.style.height = `${DOT}px`
    btn.style.right = `${item.pos.right}px`
    btn.style.bottom = `${item.pos.bottom}px`
    btn.style.left = 'auto'
    btn.style.top = 'auto'
    btn.style.animationDelay = `${i * 28}ms`

    const num = document.createElement('span')
    num.className = 'slot-num'

    if (item.kind === 'stop') {
      btn.classList.add('stop')
      btn.dataset.stop = '1'
      num.textContent = '×'
      const fill = document.createElement('span')
      fill.className = 'hold-fill'
      btn.appendChild(fill)
      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) {
          cancelStopHold()
          return
        }
        if (!state?.activeSession || state.activeSession.endIso) {
          cancelStopHold()
          return
        }
        stopHoldFired = false
        beginStopHold(btn)
      })
      btn.addEventListener('pointerup', () => {
        cancelStopHold()
      })
      btn.addEventListener('pointercancel', () => {
        cancelStopHold()
      })
      btn.addEventListener('pointerleave', () => {
        cancelStopHold()
      })
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (stopHoldFired) {
          stopHoldFired = false
          return
        }
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

function renderPendingOnWheel(pending: Session[]): void {
  if (pending.length === 0) {
    stackEl.classList.remove('above-wheel')
    stackEl.hidden = true
    stackEl.innerHTML = ''
    return
  }
  stackEl.classList.add('above-wheel')
  renderStack(pending, { allowEmpty: true })
}

function renderStack(pending: Session[], opts?: { allowEmpty?: boolean }): void {
  stackEl.hidden = false
  stackEl.innerHTML = ''

  if (pending.length === 0) {
    stackEl.hidden = true
    if (!opts?.allowEmpty) void window.whatwhen.closeUi()
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
function sliceKey(slice: ProfileSlice): string {
  return `${slice.profileSlot}:${slice.profileName}`
}

function analysisSignature(a: DayAnalysis | null): string {
  if (!a) return 'none'
  return a.slices
    .map((s) => `${s.profileSlot}|${s.profileName}|${s.profileColor}|${s.notes.join('\u241F')}`)
    .join('||')
}

function pieArcD(cx: number, cy: number, r: number, startAngle: number, sweep: number): string {
  const x1 = cx + r * Math.cos(startAngle)
  const y1 = cy + r * Math.sin(startAngle)
  const end = startAngle + sweep
  const x2 = cx + r * Math.cos(end)
  const y2 = cy + r * Math.sin(end)
  const large = sweep > Math.PI ? 1 : 0
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
}

function showSliceNotes(slice: ProfileSlice): void {
  if (notesHideTimer !== null) {
    window.clearTimeout(notesHideTimer)
    notesHideTimer = null
  }
  analysisNotes.hidden = false
  analysisNotes.classList.remove('is-empty')
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

function hideSliceNotes(): void {
  if (notesHideTimer !== null) {
    window.clearTimeout(notesHideTimer)
  }
  notesHideTimer = window.setTimeout(() => {
    notesHideTimer = null
    hoveredSliceKey = null
    analysisNotes.classList.add('is-empty')
    flushDeferredAnalysisRebuild()
  }, 120)
}

function flushDeferredAnalysisRebuild(): void {
  if (!analysisRebuildPending || state?.mode !== 'analysis') {
    analysisRebuildPending = false
    return
  }
  renderAnalysis(state.analysis)
}

function bindSliceHover(el: Element, slice: ProfileSlice): void {
  el.addEventListener('mouseenter', () => {
    hoveredSliceKey = sliceKey(slice)
    showSliceNotes(slice)
  })
  el.addEventListener('mouseleave', () => {
    if (hoveredSliceKey === sliceKey(slice)) hideSliceNotes()
  })
}

function showAnalysis(analysis: DayAnalysis | null): void {
  analysisEl.hidden = false
  renderAnalysis(analysis)
}

function renderAnalysis(analysis: DayAnalysis | null): void {
  analysisBody.innerHTML = ''

  if (!analysis || analysis.slices.length === 0) {
    analysisNotes.hidden = true
    analysisNotes.classList.add('is-empty')
    const empty = document.createElement('div')
    empty.className = 'overlay-empty'
    empty.textContent = 'No sessions yet today.'
    analysisBody.appendChild(empty)
    analysisSig = analysisSignature(analysis)
    analysisRebuildPending = false
    return
  }

  analysisNotes.hidden = false
  analysisNotes.classList.add('is-empty')

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
    row.dataset.sliceKey = sliceKey(slice)

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
    bindSliceHover(row, slice)
    bars.appendChild(row)
  }
  charts.appendChild(bars)
  analysisBody.appendChild(charts)

  const stillHovered = analysis.slices.find((s) => sliceKey(s) === hoveredSliceKey)
  if (stillHovered) {
    showSliceNotes(stillHovered)
  } else {
    hideSliceNotes()
  }
  analysisSig = analysisSignature(analysis)
  analysisRebuildPending = false
}

function updateAnalysisLive(analysis: DayAnalysis | null): void {
  if (!analysis || analysis.slices.length === 0) {
    renderAnalysis(analysis)
    return
  }
  const rows = [...analysisBody.querySelectorAll<HTMLElement>('.bar-row')]
  const paths = [...analysisBody.querySelectorAll<SVGPathElement>('.pie-chart path')]
  if (rows.length !== analysis.slices.length || paths.length !== analysis.slices.length) {
    renderAnalysis(analysis)
    return
  }
  for (let i = 0; i < analysis.slices.length; i++) {
    const key = sliceKey(analysis.slices[i])
    if (rows[i].dataset.sliceKey !== key || paths[i].dataset.sliceKey !== key) {
      renderAnalysis(analysis)
      return
    }
  }

  const summary = analysisBody.querySelector('.analysis-summary')
  if (summary) {
    summary.textContent = `Recorded ${formatDuration(analysis.trackedMs)}`
  }

  const size = 160
  const cx = size / 2
  const cy = size / 2
  const r = 68
  let angle = -Math.PI / 2
  const total = analysis.trackedMs || 1

  for (let i = 0; i < analysis.slices.length; i++) {
    const slice = analysis.slices[i]
    const fill = rows[i].querySelector<HTMLElement>('.bar-fill')
    const pct = rows[i].querySelector('.bar-pct')
    if (!fill || !pct) {
      renderAnalysis(analysis)
      return
    }
    fill.style.width = `${Math.max(2, slice.percentOfTracked)}%`
    pct.textContent = `${slice.percentOfTracked.toFixed(0)}%`
    const sweep = (slice.durationMs / total) * Math.PI * 2
    if (sweep > 0) {
      paths[i].setAttribute('d', pieArcD(cx, cy, r, angle, sweep))
      angle += sweep
    }
  }
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
    path.setAttribute('d', pieArcD(cx, cy, r, angle, sweep))
    path.setAttribute('fill', slice.profileColor)
    path.setAttribute('opacity', '0.88')
    path.setAttribute('stroke', 'rgba(0,0,0,0.25)')
    path.setAttribute('stroke-width', '1')
    path.dataset.sliceKey = sliceKey(slice)
    bindSliceHover(path, slice)
    svg.appendChild(path)
    angle += sweep
  }

  return svg
}

// —— Timeline ——
function showTimeline(sessions: Session[]): void {
  timelineEl.hidden = false
  renderTimeline(sessions)
}

function formatTimeInput(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function withTimeOfDay(iso: string, hhmm: string): string {
  const d = new Date(iso)
  const [h, m] = hhmm.split(':').map((n) => Number(n))
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0)
  return d.toISOString()
}

function sessionMidIso(session: Session): string {
  const start = new Date(session.startIso).getTime()
  const end = session.endIso ? new Date(session.endIso).getTime() : Date.now()
  return new Date(start + (end - start) / 2).toISOString()
}

function setSelectedTimeline(id: string | null, atIso?: string | null): void {
  selectedTimelineId = id
  if (atIso !== undefined) splitAtIso = atIso
  else if (!id) splitAtIso = null
  timelineEl.classList.toggle('is-inspecting', !!id)
  void window.whatwhen.setTimelineEditing(!!id)
}

function renderTimeline(sessions: Session[]): void {
  timelineTrack.innerHTML = ''
  timelineHover.hidden = true

  if (selectedTimelineId && !sessions.some((s) => s.id === selectedTimelineId)) {
    setSelectedTimeline(null)
  }

  if (sessions.length === 0) {
    timelineInspector.hidden = true
    const empty = document.createElement('div')
    empty.className = 'overlay-empty'
    empty.textContent = 'No sessions yet today.'
    timelineTrack.appendChild(empty)
    return
  }

  const now = Date.now()
  const items = sessions.map((session) => {
    const start = new Date(session.startIso).getTime()
    const end = session.endIso ? new Date(session.endIso).getTime() : now
    return { session, durationMs: Math.max(1, end - start) }
  })

  const rail = document.createElement('div')
  rail.className = 'timeline-rail'
  timelineTrack.appendChild(rail)

  items.forEach(({ session, durationMs }, i) => {
    const bubble = document.createElement('button')
    bubble.type = 'button'
    bubble.className = 'timeline-bubble'
    bubble.dataset.sessionId = session.id
    if (session.id === selectedTimelineId) bubble.classList.add('selected')
    // Flex distributes the complete track among recorded sessions. The
    // remaining width after small visual gaps is exactly duration-proportional.
    bubble.style.flexGrow = String(durationMs)
    bubble.style.flexBasis = '0'
    bubble.style.setProperty('--c', session.profileColor)
    bubble.style.animationDelay = `${i * 30}ms`

    const bar = document.createElement('span')
    bar.className = 'timeline-bar'
    bubble.append(bar)

    if (session.id === selectedTimelineId && splitAtIso) {
      const start = new Date(session.startIso).getTime()
      const end = session.endIso ? new Date(session.endIso).getTime() : now
      const at = new Date(splitAtIso).getTime()
      if (at > start && at < end) {
        const mark = document.createElement('span')
        mark.className = 'timeline-split-mark'
        mark.style.left = `${((at - start) / (end - start)) * 100}%`
        bubble.appendChild(mark)
      }
    }

    bubble.addEventListener('mouseenter', () => {
      if (selectedTimelineId) return
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
      if (selectedTimelineId) return
      timelineHover.hidden = true
    })

    bubble.addEventListener('click', (e) => {
      e.stopPropagation()
      if (selectedTimelineId === session.id) {
        const rect = bubble.getBoundingClientRect()
        const t = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
        const start = new Date(session.startIso).getTime()
        const end = session.endIso ? new Date(session.endIso).getTime() : Date.now()
        const at = new Date(start + t * (end - start)).toISOString()
        setSelectedTimeline(session.id, at)
        renderTimeline(sessions)
        return
      }
      setSelectedTimeline(session.id, sessionMidIso(session))
      timelineHover.hidden = true
      renderTimeline(sessions)
    })

    timelineTrack.appendChild(bubble)
  })

  const selected = sessions.find((s) => s.id === selectedTimelineId) ?? null
  if (selected) {
    renderTimelineInspector(selected)
  } else {
    timelineInspector.hidden = true
    timelineInspector.innerHTML = ''
  }
}

function renderTimelineInspector(session: Session): void {
  timelineInspector.hidden = false
  timelineInspector.innerHTML = ''
  const live = !session.endIso
  const splitValue = splitAtIso ?? sessionMidIso(session)

  const times = document.createElement('div')
  times.className = 'timeline-inspector-row'

  const startWrap = document.createElement('label')
  startWrap.className = 'timeline-inspector-field'
  startWrap.textContent = 'Start'
  const startInput = document.createElement('input')
  startInput.type = 'time'
  startInput.value = formatTimeInput(session.startIso)
  startInput.addEventListener('change', () => {
    const nextStart = withTimeOfDay(session.startIso, startInput.value)
    void window.whatwhen.updateSessionTimes(session.id, nextStart, session.endIso)
  })
  startWrap.appendChild(startInput)

  const endWrap = document.createElement('label')
  endWrap.className = 'timeline-inspector-field'
  endWrap.textContent = 'End'
  const endInput = document.createElement('input')
  endInput.type = 'time'
  endInput.disabled = live
  endInput.value = formatTimeInput(session.endIso ?? new Date().toISOString())
  endInput.addEventListener('change', () => {
    if (live || !session.endIso) return
    const nextEnd = withTimeOfDay(session.endIso, endInput.value)
    void window.whatwhen.updateSessionTimes(session.id, session.startIso, nextEnd)
  })
  endWrap.appendChild(endInput)
  times.append(startWrap, endWrap)

  const chips = document.createElement('div')
  chips.className = 'timeline-inspector-chips'
  const profiles = state?.profiles ?? []
  for (const profile of [...profiles].sort((a, b) => a.slot - b.slot)) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'timeline-chip'
    chip.style.setProperty('--c', profile.color)
    chip.textContent = SLOT_DISPLAY[profile.slot]
    if (profile.slot === session.profileSlot) chip.classList.add('active')
    chip.addEventListener('click', (e) => {
      e.stopPropagation()
      void window.whatwhen.reassignSession(session.id, profile.slot)
    })
    chips.appendChild(chip)
  }

  const splitRow = document.createElement('div')
  splitRow.className = 'timeline-inspector-row'
  const splitWrap = document.createElement('label')
  splitWrap.className = 'timeline-inspector-field'
  splitWrap.textContent = 'Split at'
  const splitInput = document.createElement('input')
  splitInput.type = 'time'
  splitInput.value = formatTimeInput(splitValue)
  splitInput.addEventListener('change', () => {
    splitAtIso = withTimeOfDay(session.startIso, splitInput.value)
    if (state) renderTimeline(state.todaySessions)
  })
  splitWrap.appendChild(splitInput)
  const splitBtn = document.createElement('button')
  splitBtn.type = 'button'
  splitBtn.className = 'btn-primary timeline-split-btn'
  splitBtn.textContent = 'Split'
  splitBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    const at = splitAtIso ?? withTimeOfDay(session.startIso, splitInput.value)
    splitAtIso = null
    void window.whatwhen.splitSession(session.id, at)
  })
  splitRow.append(splitWrap, splitBtn)

  timelineInspector.append(times, chips, splitRow)
}

/**
 * Wheel/stack use a larger transparent HWND with pass-through on empty glass.
 * Idle is orb-tight (no empty surface). Bubble / settings / overlays: main
 * process owns mouse policy.
 */
function needsPassThrough(): boolean {
  const mode = state?.mode
  return mode === 'wheel' || mode === 'stack'
}

function wireHit(el: HTMLElement): void {
  el.addEventListener('mouseenter', () => {
    window.whatwhen.setIgnoreMouse(false)
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

orb.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  if (state?.mode !== 'idle') return
  if ((e.target as HTMLElement).closest('#orb-badge')) return
  window.whatwhen.orbPointerDown()
})
const reportPointerUp = (): void => window.whatwhen.orbPointerUp()
orb.addEventListener('pointerup', reportPointerUp)
orb.addEventListener('pointercancel', reportPointerUp)
window.addEventListener('pointerup', reportPointerUp)
window.addEventListener('blur', reportPointerUp)
window.addEventListener('pointerup', () => {
  cancelStopHold()
})
window.addEventListener('blur', () => {
  cancelStopHold()
})

// —— Events ——
orb.addEventListener('click', (e) => {
  e.stopPropagation()
  if (state?.mode === 'bubble') {
    void leaveBubbleFromOrb()
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

timelineEl.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  if (
    t.closest('.timeline-bubble') ||
    t.closest('.timeline-inspector') ||
    t.closest('.overlay-close')
  ) {
    return
  }
  if (selectedTimelineId && state) {
    setSelectedTimeline(null)
    renderTimeline(state.todaySessions)
  }
})

/** Release Chromium focus before main demotes the transparent HWND. */
function blurBubbleInput(): void {
  bubbleInput.blur()
}

/** Enter: save, including an intentional blank. */
async function leaveBubbleSaving(): Promise<void> {
  const text = bubbleInput.value
  const id = editingId
  blurBubbleInput()
  if (id) {
    await window.whatwhen.saveNotes(id, text)
  } else {
    await window.whatwhen.dismissBubble(text)
  }
}

/** Orb click: save typed text; an empty prompt closes but stays pending. */
async function leaveBubbleFromOrb(): Promise<void> {
  if (bubbleInput.value.trim()) {
    await leaveBubbleSaving()
  } else {
    blurBubbleInput()
    await window.whatwhen.closeUi()
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
    blurBubbleInput()
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
    if (state.mode === 'timeline' && selectedTimelineId) {
      setSelectedTimeline(null)
      renderTimeline(state.todaySessions)
      return
    }
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
  window.whatwhen.onOverlayRevealed(() => {
    if (state?.mode === 'bubble') {
      requestAnimationFrame(() => bubbleInput.focus())
    }
  })
}

void boot()
