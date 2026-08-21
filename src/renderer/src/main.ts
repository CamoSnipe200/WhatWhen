import './style.css'
import type {
  DateRange,
  Profile,
  ProfileSlice,
  ProfileSlot,
  RangeAnalysis,
  Session,
  UiSnapshot
} from '../../shared/types'
import {
  SLOT_DISPLAY,
  eachDateKey,
  formatDuration,
  formatTimeLocal,
  isLightProfileColor,
  isOutlineSlot,
  isOutlineStyle,
  localDateKey,
  parseDateKey,
  profileSliceKey,
  sessionShareOf,
  sessionTitleOf
} from '../../shared/types'
import {
  emptyStateCopy,
  last7Range,
  renderCalendarPopover,
  renderDateChip,
  thisWeekRange
} from './calendar'
import { closeTimePop, createTimeField, isTimePopOpen } from './time-field'
import { renderPaletteGrid } from './palette'
import { fillPatternIndex, setFillPattern, svgFillForPattern } from './fill-pattern'
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
const analysisDayPrev = document.getElementById('analysis-day-prev') as HTMLButtonElement
const analysisDateChip = document.getElementById('analysis-date-chip') as HTMLButtonElement
const analysisDayNext = document.getElementById('analysis-day-next') as HTMLButtonElement
const analysisOpenLog = document.getElementById('analysis-open-log') as HTMLButtonElement
const analysisCalendarPop = document.getElementById('analysis-calendar-pop') as HTMLDivElement
const timelineEl = document.getElementById('timeline') as HTMLDivElement
const timelineTrack = document.getElementById('timeline-track') as HTMLDivElement
const timelineHover = document.getElementById('timeline-hover') as HTMLDivElement
const timelineInspector = document.getElementById('timeline-inspector') as HTMLDivElement
const timelineClose = document.getElementById('timeline-close') as HTMLButtonElement
const timelineDayPrev = document.getElementById('timeline-day-prev') as HTMLButtonElement
const timelineDateChip = document.getElementById('timeline-date-chip') as HTMLButtonElement
const timelineDayNext = document.getElementById('timeline-day-next') as HTMLButtonElement
const timelineOpenLog = document.getElementById('timeline-open-log') as HTMLButtonElement
const timelineCalendarPop = document.getElementById('timeline-calendar-pop') as HTMLDivElement

let state: UiSnapshot | null = null
let editingId: string | null = null
let draftProfiles: Profile[] | null = null
let paletteOpenSlot: ProfileSlot | null = null
let retiringSlot: ProfileSlot | null = null
let retireDraft: { name: string; color: string; outline: boolean } | null = null
let wheelBuilt = false
let selectedTimelineId: string | null = null
let splitAtIso: string | null = null
let hoveredSliceKey: string | null = null
let selectedSliceKey: string | null = null
let analysisSig = ''
let analysisRebuildPending = false
let notesHideTimer: number | null = null
let lastViewKey = ''
let calendarOpen = false
let monthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1)

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

  const viewKey = `${snap.view.startKey}..${snap.view.endKey}`
  const viewChanged = lastViewKey !== viewKey
  if (viewChanged) {
    lastViewKey = viewKey
    hoveredSliceKey = null
    analysisRebuildPending = false
  }

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
    renderOverlayNav(snap)
    if (viewChanged) {
      renderAnalysis(snap.viewAnalysis)
      return
    }
    const sig = analysisSignature(snap.viewAnalysis, snap.view)
    if (sig !== analysisSig) {
      if (hoveredSliceKey !== null || selectedSliceKey !== null) {
        analysisRebuildPending = true
      } else {
        renderAnalysis(snap.viewAnalysis)
      }
    } else if (hoveredSliceKey === null && selectedSliceKey === null && snap.viewIncludesToday) {
      updateAnalysisLive(snap.viewAnalysis)
    }
    return
  }

  if (!modeChanged && snap.mode === 'timeline') {
    renderOverlayNav(snap)
    if (isTimePopOpen()) return
    const prevN = prev?.viewSessions?.length
    const nextN = snap.viewSessions.length
    const prevSig = `${prev?.timelineDateKey}|${prev?.viewSessions
      ?.map((s) => `${s.id}:${s.startIso}:${s.endIso}:${s.profileSlot}:${s.profileColor}`)
      .join('|')}`
    const nextSig = `${snap.timelineDateKey}|${snap.viewSessions
      .map((s) => `${s.id}:${s.startIso}:${s.endIso}:${s.profileSlot}:${s.profileColor}`)
      .join('|')}`
    if (prevN !== nextN || prevSig !== nextSig) {
      renderTimeline(snap.viewSessions)
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
    showAnalysis(snap)
  } else if (snap.mode === 'timeline') {
    showTimeline(snap)
  }
}

function hideAllOverlays(nextMode: UiSnapshot['mode']): void {
  cancelStopHold()
  closeTimePop()
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
    paletteOpenSlot = null
    retiringSlot = null
    retireDraft = null
  }
  if (nextMode !== 'analysis') {
    if (notesHideTimer !== null) {
      window.clearTimeout(notesHideTimer)
      notesHideTimer = null
    }
    hoveredSliceKey = null
    selectedSliceKey = null
    analysisSig = ''
    analysisRebuildPending = false
    analysisEl.hidden = true
    analysisNotes.hidden = true
    analysisBody.innerHTML = ''
  }
  closeCalendar()
  if (nextMode !== 'analysis' && nextMode !== 'timeline') {
    lastViewKey = ''
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
    const share = sessionShareOf(snap.activeSession)
    orb.style.setProperty('--c', snap.activeSession.profileColor)
    if (share) {
      orb.classList.add('is-split')
      orb.classList.remove('is-outline')
      orb.style.setProperty('--c2', share.profileColor)
      orbTint.style.background = `linear-gradient(90deg, ${snap.activeSession.profileColor} 0 50%, ${share.profileColor} 50% 100%)`
    } else {
      orb.classList.remove('is-split')
      if (isOutlineStyle(snap.activeSession)) {
        orb.classList.add('is-outline')
        orbTint.style.background = 'transparent'
      } else {
        orb.classList.remove('is-outline')
        orbTint.style.background = snap.activeSession.profileColor
      }
    }
  } else {
    orb.classList.remove('active', 'is-outline', 'is-split')
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
  const mid: RadialArc = {
    radius: inner.radius + DOT + 4,
    startDeg: 102,
    endDeg: 176
  }
  const far: RadialArc = {
    radius: mid.radius + DOT + 4,
    startDeg: 100,
    endDeg: 178
  }

  const profiles = [...snap.profiles].sort((a, b) => a.slot - b.slot)
  const bySlot = (s: number): Profile =>
    profiles.find((p) => p.slot === s) ?? {
      slot: s as ProfileSlot,
      name: `Profile ${s}`,
      color: '#888',
      outline: isOutlineSlot(s),
      epoch: 0
    }

  const farSlots = [5, 4, 3, 2, 1].map(bySlot)
  const midSlots = [9, 8, 7, 6].map(bySlot)
  const innerSlots = [12, 11, 10]
  const farPos = placeOnArc(farSlots.length, far, origin, DOT)
  const midPos = placeOnArc(midSlots.length, mid, origin, DOT)
  const innerPos = placeOnArc(innerSlots.length + 1, inner, origin, DOT)

  type Placed =
    | { kind: 'profile'; profile: Profile; pos: (typeof midPos)[number] }
    | { kind: 'stop'; pos: (typeof innerPos)[number] }

  const items: Placed[] = [
    ...farSlots.map((profile, i) => ({
      kind: 'profile' as const,
      profile,
      pos: farPos[i]
    })),
    ...midSlots.map((profile, i) => ({
      kind: 'profile' as const,
      profile,
      pos: midPos[i]
    })),
    ...innerSlots.map((slot, i) => ({
      kind: 'profile' as const,
      profile: bySlot(slot),
      pos: innerPos[i]
    })),
    { kind: 'stop', pos: innerPos[innerSlots.length] }
  ]

  const colorGroup = items
    .filter((item): item is Extract<Placed, { kind: 'profile' }> => item.kind === 'profile')
    .map((item) => ({
      color: item.profile.color,
      id: String(item.profile.slot),
      slot: item.profile.slot
    }))

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
      const live = snap.activeSession && !snap.activeSession.endIso ? snap.activeSession : null
      if (live && sessionShareOf(live)?.profileSlot === profile.slot) {
        btn.classList.add('share-slot')
      }
      btn.style.setProperty('--c', profile.color)
      if (isOutlineStyle(profile)) {
        btn.classList.add('is-outline')
      } else {
        if (isLightProfileColor(profile.color)) btn.classList.add('is-light')
        setFillPattern(
          btn,
          fillPatternIndex(profile.color, profile.slot, colorGroup, String(profile.slot))
        )
      }
      num.textContent = SLOT_DISPLAY[profile.slot]
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (e.shiftKey) {
          void window.whatwhen.shiftPickProfile(profile.slot as ProfileSlot)
          return
        }
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
    const share = sessionShareOf(session)
    if (share) {
      dot.classList.add('is-split')
      dot.style.setProperty('--dot-color', session.profileColor)
      dot.style.setProperty('--c2', share.profileColor)
    } else {
      if (isOutlineStyle(session)) dot.classList.add('is-outline')
      dot.style.setProperty('--dot-color', session.profileColor)
    }
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
  bubbleTitle.textContent = sessionTitleOf(session)
  const share = sessionShareOf(session)
  bubbleSwatch.style.setProperty('--c', session.profileColor)
  bubbleSwatch.classList.remove('is-outline', 'is-split')
  if (share) {
    bubbleSwatch.classList.add('is-split')
    bubbleSwatch.style.setProperty('--c2', share.profileColor)
    bubbleSwatch.style.background = `linear-gradient(90deg, ${session.profileColor} 0 50%, ${share.profileColor} 50% 100%)`
  } else if (isOutlineStyle(session)) {
    bubbleSwatch.classList.add('is-outline')
    bubbleSwatch.style.background = 'transparent'
  } else {
    bubbleSwatch.style.background = session.profileColor
  }
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
    const av = a.slot === 0 ? 99 : a.slot
    const bv = b.slot === 0 ? 99 : b.slot
    return av - bv
  })
  const colorGroup = ordered.map((p) => ({
    color: p.color,
    id: String(p.slot),
    slot: p.slot
  }))

  for (const profile of ordered) {
    const stored = state?.profiles.find((p) => p.slot === profile.slot)
    const storedName = stored?.name ?? profile.name
    const storedColor = stored?.color ?? profile.color
    const isRetiring = retiringSlot === profile.slot

    const row = document.createElement('div')
    row.className = 'settings-row'
    if (isRetiring) row.classList.add('is-retiring')

    const slot = document.createElement('span')
    slot.className = 'slot-label'
    slot.textContent = SLOT_DISPLAY[profile.slot]

    const swatch = document.createElement('button')
    swatch.type = 'button'
    swatch.className = 'settings-swatch'
    swatch.style.setProperty('--c', isRetiring ? storedColor : profile.color)
    if (isOutlineStyle(isRetiring ? (stored ?? profile) : profile)) {
      swatch.classList.add('is-outline')
    } else {
      swatch.style.backgroundColor = isRetiring ? storedColor : profile.color
      setFillPattern(
        swatch,
        isRetiring ? 0 : fillPatternIndex(profile.color, profile.slot, colorGroup, String(profile.slot))
      )
    }
    if (isRetiring) {
      swatch.disabled = true
    } else {
      swatch.addEventListener('click', (e) => {
        e.stopPropagation()
        paletteOpenSlot = paletteOpenSlot === profile.slot ? null : profile.slot
        renderSettingsList()
      })
    }

    const name = document.createElement('input')
    name.type = 'text'
    name.value = isRetiring ? storedName : profile.name
    name.maxLength = 40
    name.placeholder = defaultName(profile.slot)
    if (isRetiring) {
      name.disabled = true
    } else {
      name.addEventListener('input', () => {
        profile.name = name.value
        const target = draftProfiles!.find((p) => p.slot === profile.slot)
        if (target) target.name = name.value
      })
    }

    const retireBtn = document.createElement('button')
    retireBtn.type = 'button'
    retireBtn.className = 'settings-retire'
    retireBtn.textContent = '⟲'
    retireBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      beginRetire(profile.slot)
    })

    row.append(slot, swatch, name, retireBtn)
    settingsList.appendChild(row)

    if (isRetiring && retireDraft) {
      const caption = document.createElement('div')
      caption.className = 'settings-retire-caption'
      caption.textContent = `Retiring “${storedName}”`
      settingsList.appendChild(caption)

      const newNameRow = document.createElement('div')
      newNameRow.className = 'settings-row'
      const newName = document.createElement('input')
      newName.type = 'text'
      newName.value = retireDraft.name
      newName.maxLength = 40
      newName.placeholder = 'new profile name'
      const startBtn = document.createElement('button')
      startBtn.type = 'button'
      startBtn.className = 'btn-primary'
      startBtn.textContent = 'Start new profile'
      const canStart = !!retireDraft.name.trim() && !!retireDraft.color
      startBtn.disabled = !canStart
      newName.addEventListener('input', () => {
        if (!retireDraft) return
        retireDraft.name = newName.value
        startBtn.disabled = !retireDraft.name.trim() || !retireDraft.color
      })
      newNameRow.appendChild(newName)
      settingsList.appendChild(newNameRow)

      const wrap = document.createElement('div')
      wrap.className = 'palette-wrap'
      renderPaletteGrid(wrap, {
        selected: retireDraft.color,
        selectedOutline: retireDraft.outline,
        onPick: (color, outline) => {
          if (!retireDraft) return
          retireDraft.color = color
          retireDraft.outline = outline
          renderSettingsList()
        }
      })
      settingsList.appendChild(wrap)

      const actions = document.createElement('div')
      actions.className = 'settings-retire-actions'
      const cancelBtn = document.createElement('button')
      cancelBtn.type = 'button'
      cancelBtn.className = 'settings-retire-cancel'
      cancelBtn.textContent = 'Cancel'
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        cancelRetire()
      })
      startBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        void confirmRetire(profile.slot)
      })
      actions.append(cancelBtn, startBtn)
      settingsList.appendChild(actions)

      const running =
        !!state?.activeSession &&
        !state.activeSession.endIso &&
        state.activeSession.profileSlot === profile.slot
      if (running) {
        const hint = document.createElement('div')
        hint.className = 'settings-retire-hint'
        hint.textContent = `Timer running · this segment stays on “${storedName}”`
        settingsList.appendChild(hint)
      }
    } else if (paletteOpenSlot === profile.slot) {
      const wrap = document.createElement('div')
      wrap.className = 'palette-wrap'
      renderPaletteGrid(wrap, {
        selected: profile.color,
        selectedOutline: isOutlineStyle(profile),
        onPick: (color, outline) => {
          profile.color = color
          profile.outline = outline
          const target = draftProfiles!.find((p) => p.slot === profile.slot)
          if (target) {
            target.color = color
            target.outline = outline
          }
          paletteOpenSlot = null
          renderSettingsList()
        }
      })
      settingsList.appendChild(wrap)
    }
  }
}

function beginRetire(slot: ProfileSlot): void {
  if (!draftProfiles) return
  const stored = state?.profiles.find((p) => p.slot === slot)
  const draft = draftProfiles.find((p) => p.slot === slot)
  if (draft) {
    draft.name = stored?.name ?? draft.name
    draft.color = stored?.color ?? draft.color
    draft.outline = stored?.outline ?? draft.outline
  }
  retiringSlot = slot
  retireDraft = {
    name: '',
    color: stored?.color ?? draft?.color ?? '',
    outline: stored?.outline ?? draft?.outline ?? false
  }
  paletteOpenSlot = null
  renderSettingsList()
}

function cancelRetire(): void {
  retiringSlot = null
  retireDraft = null
  renderSettingsList()
}

async function confirmRetire(slot: ProfileSlot): Promise<void> {
  if (!retireDraft || !draftProfiles) return
  const { name, color, outline } = retireDraft
  if (!name.trim() || !color) return
  await window.whatwhen.updateProfiles(
    draftProfiles.map((p) => ({ ...p, name: p.name.trim() || defaultName(p.slot) }))
  )
  const snap = await window.whatwhen.retireProfile(slot, name, color, outline)
  retiringSlot = null
  retireDraft = null
  paletteOpenSlot = null
  draftProfiles = null
  applyState(snap)
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

function closeCalendar(): void {
  calendarOpen = false
  analysisCalendarPop.hidden = true
  timelineCalendarPop.hidden = true
}

function calendarHandlers(): {
  onPickDay: (dateKey: string) => void
  onExtendTo: (dateKey: string) => void
  onToday: () => void
  onLast7: () => void
  onThisWeek: () => void
  onMonthChange: (month: Date) => void
} {
  return {
    onPickDay: (dateKey) => {
      closeCalendar()
      void window.whatwhen.setViewRange(dateKey, dateKey)
    },
    onExtendTo: (dateKey) => {
      if (!state) return
      closeCalendar()
      void window.whatwhen.setViewRange(state.view.startKey, dateKey)
    },
    onToday: () => {
      closeCalendar()
      void window.whatwhen.resetViewToday()
    },
    onLast7: () => {
      closeCalendar()
      const range = last7Range()
      void window.whatwhen.setViewRange(range.startKey, range.endKey)
    },
    onThisWeek: () => {
      closeCalendar()
      const range = thisWeekRange()
      void window.whatwhen.setViewRange(range.startKey, range.endKey)
    },
    onMonthChange: (month) => {
      monthCursor = new Date(month.getFullYear(), month.getMonth(), 1)
      if (state && calendarOpen) paintCalendar(state)
    }
  }
}

function paintCalendar(snap: UiSnapshot): void {
  const pop = snap.mode === 'timeline' ? timelineCalendarPop : analysisCalendarPop
  const other = snap.mode === 'timeline' ? analysisCalendarPop : timelineCalendarPop
  other.hidden = true
  pop.hidden = false
  renderCalendarPopover(pop, monthCursor, snap, calendarHandlers())
}

function openCalendar(which: 'analysis' | 'timeline'): void {
  if (!state) return
  const key = parseDateKey(
    which === 'timeline' ? state.timelineDateKey : state.view.startKey
  )
  monthCursor = key
    ? new Date(key.getFullYear(), key.getMonth(), 1)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  calendarOpen = true
  paintCalendar(state)
}

function toggleCalendar(which: 'analysis' | 'timeline'): void {
  if (calendarOpen) {
    closeCalendar()
    return
  }
  openCalendar(which)
}

function renderOverlayNav(snap: UiSnapshot): void {
  const todayKey = localDateKey()
  renderDateChip(analysisDateChip, snap.view, todayKey)
  renderDateChip(timelineDateChip, snap.view, todayKey)

  analysisDayPrev.hidden = true
  analysisDayNext.hidden = true

  const isRange = snap.view.startKey !== snap.view.endKey
  timelineDayPrev.hidden = !isRange
  timelineDayNext.hidden = !isRange
  const keys = eachDateKey(snap.view.startKey, snap.view.endKey)
  const idx = keys.indexOf(snap.timelineDateKey)
  timelineDayPrev.disabled = idx <= 0
  timelineDayNext.disabled = idx < 0 || idx >= keys.length - 1

  analysisOpenLog.disabled = !snap.viewLogExists
  timelineOpenLog.disabled = !snap.viewLogExists

  if (calendarOpen) paintCalendar(snap)
}

function currentEmptyCopy(snap: UiSnapshot): string {
  return emptyStateCopy({
    range: snap.view,
    timelineDateKey: snap.timelineDateKey,
    viewLogExists: snap.viewLogExists,
    isTimeline: snap.mode === 'timeline',
    todayKey: localDateKey()
  })
}

function stepTimeline(delta: number): void {
  if (!state) return
  const keys = eachDateKey(state.view.startKey, state.view.endKey)
  const idx = keys.indexOf(state.timelineDateKey)
  const next = keys[idx + delta]
  if (next) void window.whatwhen.setTimelineDay(next)
}

// —— Analysis ——
function sliceKey(slice: ProfileSlice): string {
  return profileSliceKey(slice)
}

function analysisSignature(a: RangeAnalysis, view: DateRange): string {
  return `${view.startKey}..${view.endKey}|${a.slices
    .map(
      (s) =>
        `${s.profileSlot}|${s.profileName}|${s.profileColor}|${s.profileOutline}|${s.profileEpoch}|${s.notes.join('\u241F')}`
    )
    .join('||')}`
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

function sliceByKey(key: string | null): ProfileSlice | undefined {
  if (!key) return undefined
  return state?.viewAnalysis.slices.find((s) => sliceKey(s) === key)
}

function paintSliceSelection(): void {
  const key = selectedSliceKey
  analysisBody.querySelectorAll<HTMLElement>('.bar-row').forEach((row) => {
    row.classList.toggle('is-selected', row.dataset.sliceKey === key)
  })
  analysisBody.querySelectorAll<SVGPathElement>('.pie-chart path').forEach((path) => {
    path.classList.toggle('is-selected', path.dataset.sliceKey === key)
  })
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
  const pinned = sliceByKey(selectedSliceKey)
  if (pinned) {
    if (notesHideTimer !== null) {
      window.clearTimeout(notesHideTimer)
      notesHideTimer = null
    }
    hoveredSliceKey = null
    showSliceNotes(pinned)
    return
  }
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
  renderAnalysis(state.viewAnalysis)
}

function bindSliceHover(el: Element, slice: ProfileSlice): void {
  el.addEventListener('mouseenter', () => {
    hoveredSliceKey = sliceKey(slice)
    showSliceNotes(slice)
  })
  el.addEventListener('mouseleave', () => {
    if (hoveredSliceKey === sliceKey(slice)) {
      hoveredSliceKey = null
      hideSliceNotes()
    }
  })
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    const key = sliceKey(slice)
    selectedSliceKey = selectedSliceKey === key ? null : key
    paintSliceSelection()
    if (selectedSliceKey || hoveredSliceKey === key) {
      showSliceNotes(slice)
    } else {
      hideSliceNotes()
    }
  })
}

function showAnalysis(snap: UiSnapshot): void {
  analysisEl.hidden = false
  renderOverlayNav(snap)
  renderAnalysis(snap.viewAnalysis)
}

function renderAnalysis(analysis: RangeAnalysis): void {
  analysisBody.innerHTML = ''
  const view = state?.view ?? analysis.range

  if (analysis.slices.length === 0) {
    analysisNotes.hidden = true
    analysisNotes.classList.add('is-empty')
    const empty = document.createElement('div')
    empty.className = 'overlay-empty'
    empty.textContent = state ? currentEmptyCopy(state) : 'No sessions yet today.'
    analysisBody.appendChild(empty)
    analysisSig = analysisSignature(analysis, view)
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

  const sliceGroup = analysis.slices.map((s) => ({
    color: s.profileColor,
    id: sliceKey(s),
    slot: s.profileSlot
  }))

  const bars = document.createElement('div')
  bars.className = 'bar-list'
  for (const slice of analysis.slices) {
    const row = document.createElement('div')
    row.className = 'bar-row'
    row.dataset.sliceKey = sliceKey(slice)
    const outline = isOutlineStyle(slice)
    const pat = outline
      ? 0
      : fillPatternIndex(slice.profileColor, slice.profileSlot, sliceGroup, sliceKey(slice))

    const label = document.createElement('div')
    label.className = 'bar-label'
    const sw = document.createElement('span')
    sw.className = 'bar-swatch'
    sw.style.setProperty('--c', slice.profileColor)
    if (outline) {
      sw.classList.add('is-outline')
      sw.style.borderColor = slice.profileColor
    } else {
      sw.style.backgroundColor = slice.profileColor
      setFillPattern(sw, pat)
    }
    const name = document.createElement('span')
    name.textContent = slice.profileName
    label.append(sw, name)

    const track = document.createElement('div')
    track.className = 'bar-track'
    const fill = document.createElement('div')
    fill.className = 'bar-fill'
    fill.style.width = `${Math.max(2, slice.percentOfTracked)}%`
    fill.style.setProperty('--c', slice.profileColor)
    if (outline) {
      fill.classList.add('is-outline')
      fill.style.borderColor = slice.profileColor
    } else {
      fill.style.backgroundColor = slice.profileColor
      setFillPattern(fill, pat)
    }
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

  if (selectedSliceKey && !analysis.slices.some((s) => sliceKey(s) === selectedSliceKey)) {
    selectedSliceKey = null
  }
  const stillShown =
    analysis.slices.find((s) => sliceKey(s) === hoveredSliceKey) ??
    analysis.slices.find((s) => sliceKey(s) === selectedSliceKey)
  if (stillShown) {
    showSliceNotes(stillShown)
  } else {
    hideSliceNotes()
  }
  paintSliceSelection()
  analysisSig = analysisSignature(analysis, view)
  analysisRebuildPending = false
}

function updateAnalysisLive(analysis: RangeAnalysis): void {
  if (analysis.slices.length === 0) {
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

function buildPieSvg(analysis: RangeAnalysis): SVGSVGElement {
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
  const sliceGroup = analysis.slices.map((s) => ({
    color: s.profileColor,
    id: sliceKey(s),
    slot: s.profileSlot
  }))

  for (const slice of analysis.slices) {
    const sweep = (slice.durationMs / total) * Math.PI * 2
    if (sweep <= 0) continue
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', pieArcD(cx, cy, r, angle, sweep))
    if (isOutlineStyle(slice)) {
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', slice.profileColor)
      path.setAttribute('stroke-width', '3')
      path.setAttribute('stroke-linejoin', 'round')
      path.setAttribute('opacity', '1')
    } else {
      const pat = fillPatternIndex(
        slice.profileColor,
        slice.profileSlot,
        sliceGroup,
        sliceKey(slice)
      )
      const fillId = `fp-${sliceKey(slice).replace(/[^a-zA-Z0-9_-]/g, '_')}`
      path.setAttribute('fill', svgFillForPattern(svg, slice.profileColor, pat, fillId))
      path.setAttribute('opacity', '0.88')
      path.setAttribute('stroke', 'rgba(0,0,0,0.25)')
      path.setAttribute('stroke-width', '1')
    }
    path.dataset.sliceKey = sliceKey(slice)
    bindSliceHover(path, slice)
    svg.appendChild(path)
    angle += sweep
  }

  return svg
}

// —— Timeline ——
function showTimeline(snap: UiSnapshot): void {
  timelineEl.hidden = false
  renderOverlayNav(snap)
  renderTimeline(snap.viewSessions)
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
    empty.textContent = state ? currentEmptyCopy(state) : 'No sessions yet today.'
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

  const colorGroup: { color: string; id: string; slot: typeof items[number]['session']['profileSlot'] }[] = []
  const seenStories = new Set<string>()
  for (const { session } of items) {
    const id = profileSliceKey(session)
    if (seenStories.has(id)) continue
    seenStories.add(id)
    colorGroup.push({ color: session.profileColor, id, slot: session.profileSlot })
  }

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
    const share = sessionShareOf(session)
    if (share) {
      bar.classList.add('is-split')
      bubble.style.setProperty('--c2', share.profileColor)
    } else if (isOutlineStyle(session)) {
      bar.classList.add('is-outline')
    } else {
      setFillPattern(
        bar,
        fillPatternIndex(
          session.profileColor,
          session.profileSlot,
          colorGroup,
          profileSliceKey(session)
        )
      )
    }
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
      h.textContent = `${sessionTitleOf(session)} · ${formatTimeLocal(session.startIso)} – ${endLabel}`
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
    closeTimePop()
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
  startWrap.append('Start')
  startWrap.appendChild(
    createTimeField({
      valueHhmm: formatTimeInput(session.startIso),
      onChange: (hhmm) => {
        const nextStart = withTimeOfDay(session.startIso, hhmm)
        void window.whatwhen.updateSessionTimes(session.id, nextStart, session.endIso)
      }
    })
  )

  const endWrap = document.createElement('label')
  endWrap.className = 'timeline-inspector-field'
  endWrap.append('End')
  endWrap.appendChild(
    createTimeField({
      valueHhmm: formatTimeInput(session.endIso ?? new Date().toISOString()),
      disabled: live,
      onChange: (hhmm) => {
        if (live || !session.endIso) return
        const nextEnd = withTimeOfDay(session.endIso, hhmm)
        void window.whatwhen.updateSessionTimes(session.id, session.startIso, nextEnd)
      }
    })
  )
  times.append(startWrap, endWrap)

  const chips = document.createElement('div')
  chips.className = 'timeline-inspector-chips'
  const profiles = state?.profiles ?? []
  for (const profile of [...profiles].sort((a, b) => a.slot - b.slot)) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'timeline-chip'
    chip.style.setProperty('--c', profile.color)
    if (isOutlineStyle(profile)) chip.classList.add('is-outline')
    chip.textContent = SLOT_DISPLAY[profile.slot]
    if (profile.slot === session.profileSlot) chip.classList.add('active')
    chip.addEventListener('click', (e) => {
      e.stopPropagation()
      closeTimePop()
      void window.whatwhen.reassignSession(session.id, profile.slot)
    })
    chips.appendChild(chip)
  }

  const shareRow = document.createElement('div')
  shareRow.className = 'timeline-inspector-chips is-share'
  const shareLabel = document.createElement('span')
  shareLabel.className = 'timeline-inspector-label'
  shareLabel.textContent = 'Half with'
  shareRow.appendChild(shareLabel)
  const shared = sessionShareOf(session)
  for (const profile of [...profiles].sort((a, b) => a.slot - b.slot)) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'timeline-chip'
    chip.style.setProperty('--c', profile.color)
    if (isOutlineStyle(profile)) chip.classList.add('is-outline')
    chip.textContent = SLOT_DISPLAY[profile.slot]
    if (shared?.profileSlot === profile.slot) chip.classList.add('is-share')
    if (profile.slot === session.profileSlot) chip.classList.add('is-primary')
    chip.addEventListener('click', (e) => {
      e.stopPropagation()
      closeTimePop()
      void window.whatwhen.shareSession(session.id, profile.slot)
    })
    shareRow.appendChild(chip)
  }

  const splitRow = document.createElement('div')
  splitRow.className = 'timeline-inspector-row'
  const splitWrap = document.createElement('label')
  splitWrap.className = 'timeline-inspector-field'
  splitWrap.append('Split at')
  splitWrap.appendChild(
    createTimeField({
      valueHhmm: formatTimeInput(splitValue),
      onChange: (hhmm) => {
        splitAtIso = withTimeOfDay(session.startIso, hhmm)
        if (state) renderTimeline(state.viewSessions)
      }
    })
  )
  const splitBtn = document.createElement('button')
  splitBtn.type = 'button'
  splitBtn.className = 'btn-primary timeline-split-btn'
  splitBtn.textContent = 'Split'
  splitBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    closeTimePop()
    const at = splitAtIso ?? sessionMidIso(session)
    splitAtIso = null
    void window.whatwhen.splitSession(session.id, at)
  })
  splitRow.append(splitWrap, splitBtn)

  timelineInspector.append(times, chips, shareRow, splitRow)
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

analysisNotes.addEventListener('mouseenter', () => {
  if (notesHideTimer !== null) {
    window.clearTimeout(notesHideTimer)
    notesHideTimer = null
  }
})

analysisNotes.addEventListener('mouseleave', () => {
  if (!hoveredSliceKey) hideSliceNotes()
})

analysisEl.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  if (
    t.closest('.bar-row') ||
    t.closest('.pie-chart') ||
    t.closest('.analysis-notes') ||
    t.closest('.overlay-close') ||
    t.closest('.overlay-nav') ||
    t.closest('.calendar-pop')
  ) {
    return
  }
  if (!selectedSliceKey) return
  selectedSliceKey = null
  paintSliceSelection()
  hideSliceNotes()
})

analysisDateChip.addEventListener('click', (e) => {
  e.stopPropagation()
  toggleCalendar('analysis')
})
timelineDateChip.addEventListener('click', (e) => {
  e.stopPropagation()
  toggleCalendar('timeline')
})

analysisOpenLog.addEventListener('click', (e) => {
  e.stopPropagation()
  if (state) void window.whatwhen.openDayLog(state.timelineDateKey)
})
timelineOpenLog.addEventListener('click', (e) => {
  e.stopPropagation()
  if (state) void window.whatwhen.openDayLog(state.timelineDateKey)
})

timelineDayPrev.addEventListener('click', (e) => {
  e.stopPropagation()
  stepTimeline(-1)
})
timelineDayNext.addEventListener('click', (e) => {
  e.stopPropagation()
  stepTimeline(1)
})

timelineClose.addEventListener('click', () => {
  void window.whatwhen.closeUi()
})

window.addEventListener('click', (e) => {
  const t = e.target as Node
  if (!(e.target as HTMLElement).closest('.time-field')) {
    closeTimePop()
  }
  if (!calendarOpen) return
  if (
    analysisCalendarPop.contains(t) ||
    timelineCalendarPop.contains(t) ||
    analysisDateChip.contains(t) ||
    timelineDateChip.contains(t)
  ) {
    return
  }
  closeCalendar()
})

timelineEl.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  if (
    t.closest('.timeline-bubble') ||
    t.closest('.timeline-inspector') ||
    t.closest('.time-field') ||
    t.closest('.overlay-close') ||
    t.closest('.overlay-nav') ||
    t.closest('.calendar-pop')
  ) {
    return
  }
  if (selectedTimelineId && state) {
    setSelectedTimeline(null)
    renderTimeline(state.viewSessions)
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
      renderTimeline(state.viewSessions)
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
