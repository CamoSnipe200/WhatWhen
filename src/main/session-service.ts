import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import {
  AppConfig,
  Profile,
  ProfileSlot,
  Session,
  UiSnapshot,
  computeDayAnalysis,
  dayStart,
  formatDuration,
  localDateKey
} from '../shared/types'
import {
  listPending,
  loadConfig,
  loadDayLog,
  loadRuntime,
  saveConfig,
  saveRuntime,
  upsertSession
} from './store'
import { getDayMarkdownPath } from './paths'

type Listener = (snap: UiSnapshot) => void

export class SessionService {
  private config: AppConfig
  private active: Session | null = null
  private bubbleSession: Session | null = null
  /** Opened via pending stack / badge — Esc empty dismisses instead of keeping pending */
  private bubbleFromBacklog = false
  private mode: UiSnapshot['mode'] = 'idle'
  private listeners = new Set<Listener>()
  private tickTimer: ReturnType<typeof setInterval> | null = null
  hotkeysOk = true

  constructor() {
    this.config = loadConfig()
    const runtime = loadRuntime()
    if (runtime.activeSession && !runtime.activeSession.endIso) {
      const orphan = {
        ...runtime.activeSession,
        endIso: new Date().toISOString(),
        notesStatus: 'pending' as const
      }
      upsertSession(this.config.settings.logDir, orphan)
      this.active = null
      saveRuntime({ activeSession: null })
    } else {
      this.active = runtime.activeSession
    }
    this.startTick()
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    const snap = this.snapshot()
    for (const fn of this.listeners) fn(snap)
  }

  private startTick(): void {
    if (this.tickTimer) clearInterval(this.tickTimer)
    // Elapsed-only tick — renderer must not rebuild wheel/stack on these
    this.tickTimer = setInterval(() => {
      if (this.active && !this.active.endIso) this.emit()
    }, 1000)
  }

  getConfig(): AppConfig {
    return this.config
  }

  updateProfiles(profiles: Profile[]): void {
    this.config.profiles = profiles
    saveConfig(this.config)
    this.emit()
  }

  updateSettings(partial: Partial<AppConfig['settings']>): void {
    this.config.settings = { ...this.config.settings, ...partial }
    saveConfig(this.config)
    this.emit()
  }

  todayLogExists(): boolean {
    const md = getDayMarkdownPath(this.config.settings.logDir, localDateKey())
    return existsSync(md)
  }

  snapshot(): UiSnapshot {
    const logDir = this.config.settings.logDir
    const pending = listPending(logDir)
    const dayLog = loadDayLog(logDir)
    // Include in-progress active session for live analysis/timeline
    const sessions = [...dayLog.sessions]
    if (this.active && !this.active.endIso) {
      const idx = sessions.findIndex((s) => s.id === this.active!.id)
      if (idx >= 0) sessions[idx] = this.active
      else sessions.push(this.active)
    }
    const analysis = computeDayAnalysis({ date: dayLog.date, sessions })
    return {
      mode: this.mode,
      activeSession: this.active,
      elapsedMs: this.active
        ? Date.now() - new Date(this.active.startIso).getTime()
        : 0,
      pending,
      bubbleSession: this.bubbleSession,
      bubbleFromBacklog: this.bubbleFromBacklog,
      profiles: this.config.profiles,
      hotkeysOk: this.hotkeysOk,
      todayLogExists: this.todayLogExists(),
      todaySessions: sessions.sort(
        (a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime()
      ),
      analysis
    }
  }

  getProfile(slot: ProfileSlot): Profile {
    return (
      this.config.profiles.find((p) => p.slot === slot) ?? {
        slot,
        name: `Profile ${slot}`,
        color: '#888888'
      }
    )
  }

  /**
   * Switch to profile slot. Ends current session (if any) and prompts notes.
   * Closes the radial wheel after selection.
   */
  switchProfile(slot: ProfileSlot): UiSnapshot {
    if (this.active?.profileSlot === slot && !this.active.endIso) {
      this.mode = 'idle'
      this.emit()
      return this.snapshot()
    }

    const closed = this.endActiveSession()
    const profile = this.getProfile(slot)
    const now = new Date().toISOString()
    this.active = {
      id: randomUUID(),
      profileSlot: slot,
      profileName: profile.name,
      profileColor: profile.color,
      startIso: now,
      endIso: null,
      notes: '',
      notesStatus: 'pending'
    }
    saveRuntime({ activeSession: this.active })
    upsertSession(this.config.settings.logDir, this.active)

    if (closed) {
      this.bubbleSession = closed
      this.bubbleFromBacklog = false
      this.mode = 'bubble'
    } else {
      this.mode = 'idle'
      this.bubbleSession = null
      this.bubbleFromBacklog = false
    }

    this.emit()
    return this.snapshot()
  }

  /**
   * Insert a segment boundary on the current profile: end → note bubble → restart same slot.
   * Hotkey for adding a comment anytime while a timer runs.
   */
  insertSegment(): UiSnapshot {
    if (!this.active || this.active.endIso) {
      return this.snapshot()
    }
    const slot = this.active.profileSlot
    const closed = this.endActiveSession()
    const profile = this.getProfile(slot)
    const now = new Date().toISOString()
    this.active = {
      id: randomUUID(),
      profileSlot: slot,
      profileName: profile.name,
      profileColor: profile.color,
      startIso: now,
      endIso: null,
      notes: '',
      notesStatus: 'pending'
    }
    saveRuntime({ activeSession: this.active })
    upsertSession(this.config.settings.logDir, this.active)

    if (closed) {
      this.bubbleSession = closed
      this.bubbleFromBacklog = false
      this.mode = 'bubble'
    }
    this.emit()
    return this.snapshot()
  }

  stop(): UiSnapshot {
    if (!this.active || this.active.endIso) {
      // Already idle — no-op
      return this.snapshot()
    }
    const closed = this.endActiveSession()
    this.active = null
    saveRuntime({ activeSession: null })
    if (closed) {
      this.bubbleSession = closed
      this.bubbleFromBacklog = false
      this.mode = 'bubble'
    } else {
      this.mode = 'idle'
      this.bubbleSession = null
      this.bubbleFromBacklog = false
    }
    this.emit()
    return this.snapshot()
  }

  private endActiveSession(): Session | null {
    if (!this.active || this.active.endIso) return null
    const endIso = new Date().toISOString()
    const closed: Session = {
      ...this.active,
      endIso,
      notes: '',
      notesStatus: 'pending'
    }
    const startKey = localDateKey(new Date(closed.startIso))
    const endKey = localDateKey(new Date(endIso))
    if (startKey !== endKey) {
      const start = new Date(closed.startIso)
      const eod = new Date(start)
      eod.setHours(23, 59, 59, 999)
      closed.endIso = eod.toISOString()
    }
    upsertSession(this.config.settings.logDir, closed)
    this.active = null
    saveRuntime({ activeSession: null })
    return closed
  }

  openWheel(): UiSnapshot {
    this.mode = 'wheel'
    this.bubbleSession = null
    this.bubbleFromBacklog = false
    this.emit()
    return this.snapshot()
  }

  openStack(): UiSnapshot {
    this.mode = 'stack'
    this.bubbleSession = null
    this.bubbleFromBacklog = false
    this.emit()
    return this.snapshot()
  }

  openSettings(): UiSnapshot {
    this.mode = 'settings'
    this.bubbleSession = null
    this.bubbleFromBacklog = false
    this.emit()
    return this.snapshot()
  }

  openAnalysis(): UiSnapshot {
    this.mode = 'analysis'
    this.bubbleSession = null
    this.bubbleFromBacklog = false
    this.emit()
    return this.snapshot()
  }

  openTimeline(): UiSnapshot {
    this.mode = 'timeline'
    this.bubbleSession = null
    this.bubbleFromBacklog = false
    this.emit()
    return this.snapshot()
  }

  closeUi(): UiSnapshot {
    // Orb/UI close while editing: empty → keep pending; text → save
    if (this.mode === 'bubble' && this.bubbleSession) {
      const notes = this.bubbleSession.notes || ''
      if (notes.trim()) {
        this.persistNotes(this.bubbleSession.id, notes)
      }
      // empty: leave notesStatus pending as already stored
    }
    this.mode = 'idle'
    this.bubbleSession = null
    this.bubbleFromBacklog = false
    this.emit()
    return this.snapshot()
  }

  openBubble(sessionId: string): UiSnapshot {
    const pending = listPending(this.config.settings.logDir)
    const session = pending.find((s) => s.id === sessionId)
    if (session) {
      this.bubbleSession = session
      this.bubbleFromBacklog = true
      this.mode = 'bubble'
    }
    this.emit()
    return this.snapshot()
  }

  saveNotes(sessionId: string, notes: string): UiSnapshot {
    this.persistNotes(sessionId, notes)
    this.bubbleSession = null
    this.bubbleFromBacklog = false
    this.mode = 'idle'
    this.emit()
    return this.snapshot()
  }

  /**
   * Escape with empty draft:
   * - Fresh switch/stop bubble → leave UI, keep pending badge
   * - Backlog pending bubble → dismiss (skipped) so it leaves the queue
   */
  bubbleEscape(): UiSnapshot {
    if (this.bubbleFromBacklog && this.bubbleSession) {
      this.skipNotes(this.bubbleSession.id)
      this.bubbleSession = null
      this.bubbleFromBacklog = false
      const remaining = listPending(this.config.settings.logDir)
      this.mode = remaining.length > 0 ? 'stack' : 'idle'
      this.emit()
      return this.snapshot()
    }
    this.bubbleSession = null
    this.bubbleFromBacklog = false
    this.mode = 'idle'
    this.emit()
    return this.snapshot()
  }

  /** Save notes for a session id (empty string = saved blank) */
  private persistNotes(sessionId: string, notes: string): void {
    const logDir = this.config.settings.logDir
    const log = loadDayLog(logDir)
    const session = log.sessions.find((s) => s.id === sessionId)
    if (session) {
      const updated: Session = {
        ...session,
        notes: notes.trim(),
        notesStatus: 'saved'
      }
      upsertSession(logDir, updated)
    }
  }

  /** Mark backlog notes as skipped (clears pending without requiring text). */
  private skipNotes(sessionId: string): void {
    const logDir = this.config.settings.logDir
    const log = loadDayLog(logDir)
    const session = log.sessions.find((s) => s.id === sessionId)
    if (session) {
      const updated: Session = {
        ...session,
        notesStatus: 'skipped'
      }
      upsertSession(logDir, updated)
    }
  }

  /** Save bubble with current draft text then close (clears pending) */
  dismissBubbleWithNotes(notes: string): UiSnapshot {
    if (this.bubbleSession) {
      this.persistNotes(this.bubbleSession.id, notes)
    }
    this.bubbleSession = null
    this.bubbleFromBacklog = false
    this.mode = 'idle'
    this.emit()
    return this.snapshot()
  }

  stackEscape(): UiSnapshot {
    this.mode = 'idle'
    this.bubbleSession = null
    this.bubbleFromBacklog = false
    this.emit()
    return this.snapshot()
  }

  /** Left-click orb: toggle radial profile wheel */
  toggleWheel(): UiSnapshot {
    if (this.mode === 'wheel') {
      this.mode = 'idle'
      this.emit()
      return this.snapshot()
    }
    if (this.mode === 'bubble') {
      return this.bubbleEscape()
    }
    if (
      this.mode === 'settings' ||
      this.mode === 'stack' ||
      this.mode === 'analysis' ||
      this.mode === 'timeline'
    ) {
      this.mode = 'idle'
      this.bubbleSession = null
      this.emit()
      return this.snapshot()
    }
    return this.openWheel()
  }

  elapsedLabel(): string {
    if (!this.active) return ''
    const ms = Date.now() - new Date(this.active.startIso).getTime()
    return formatDuration(ms)
  }

  private listedToday(): Session[] {
    const logDir = this.config.settings.logDir
    const dayLog = loadDayLog(logDir)
    const sessions = [...dayLog.sessions]
    if (this.active && !this.active.endIso) {
      const idx = sessions.findIndex((s) => s.id === this.active!.id)
      if (idx >= 0) sessions[idx] = this.active
      else sessions.push(this.active)
    }
    return sessions.sort(
      (a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime()
    )
  }

  /**
   * Edit a recorded session's time window. Clamps to the same local day and
   * neighboring sessions so ranges cannot overlap. Live sessions can change
   * start only.
   */
  updateSessionTimes(
    id: string,
    startIso: string,
    endIso: string | null
  ): UiSnapshot {
    const sessions = this.listedToday()
    const idx = sessions.findIndex((s) => s.id === id)
    if (idx < 0) return this.snapshot()

    const current = sessions[idx]
    const isLive = !!(this.active?.id === id && !this.active.endIso)
    const origin = new Date(current.startIso)
    const day0 = dayStart(origin).getTime()
    const dayClose = new Date(origin)
    dayClose.setHours(23, 59, 59, 999)
    const now = Date.now()
    const isToday = localDateKey(origin) === localDateKey()
    const maxDayEnd = isToday ? now : dayClose.getTime()

    const prev = idx > 0 ? sessions[idx - 1] : null
    const next = idx < sessions.length - 1 ? sessions[idx + 1] : null
    const minStart = prev
      ? new Date(prev.endIso ?? prev.startIso).getTime()
      : day0

    let startMs = new Date(startIso).getTime()
    if (Number.isNaN(startMs)) return this.snapshot()
    startMs = Math.max(minStart, Math.min(startMs, dayClose.getTime()))
    startMs = Math.max(day0, startMs)

    if (isLive) {
      startMs = Math.min(startMs, now - 1000)
      if (startMs >= now) return this.snapshot()
      const updated: Session = {
        ...current,
        startIso: new Date(startMs).toISOString(),
        endIso: null
      }
      this.active = updated
      saveRuntime({ activeSession: updated })
      upsertSession(this.config.settings.logDir, updated)
      this.emit()
      return this.snapshot()
    }

    const maxEnd = next ? new Date(next.startIso).getTime() : maxDayEnd
    let endMs = endIso
      ? new Date(endIso).getTime()
      : current.endIso
        ? new Date(current.endIso).getTime()
        : maxEnd
    if (Number.isNaN(endMs)) return this.snapshot()
    endMs = Math.min(maxEnd, Math.max(endMs, startMs + 1000))
    endMs = Math.min(endMs, maxDayEnd)
    if (startMs >= endMs) return this.snapshot()

    const updated: Session = {
      ...current,
      startIso: new Date(startMs).toISOString(),
      endIso: new Date(endMs).toISOString()
    }
    upsertSession(this.config.settings.logDir, updated)
    this.emit()
    return this.snapshot()
  }

  reassignSession(id: string, slot: ProfileSlot): UiSnapshot {
    const profile = this.getProfile(slot)
    const patch = {
      profileSlot: slot,
      profileName: profile.name,
      profileColor: profile.color
    }

    if (this.active?.id === id && !this.active.endIso) {
      this.active = { ...this.active, ...patch }
      saveRuntime({ activeSession: this.active })
      upsertSession(this.config.settings.logDir, this.active)
      this.emit()
      return this.snapshot()
    }

    const log = loadDayLog(this.config.settings.logDir)
    const session = log.sessions.find((s) => s.id === id)
    if (!session) return this.snapshot()
    upsertSession(this.config.settings.logDir, { ...session, ...patch })
    this.emit()
    return this.snapshot()
  }

  /**
   * Split at atIso. First half keeps original start + notes; second half is a
   * new id with empty pending notes. Splitting the live session leaves the
   * second half running from atIso.
   */
  splitSession(id: string, atIso: string): UiSnapshot {
    const at = new Date(atIso).getTime()
    if (Number.isNaN(at)) return this.snapshot()

    const sessions = this.listedToday()
    const current = sessions.find((s) => s.id === id)
    if (!current) return this.snapshot()

    const start = new Date(current.startIso).getTime()
    const isLive = !!(this.active?.id === id && !this.active.endIso)
    const end = current.endIso ? new Date(current.endIso).getTime() : Date.now()
    if (at <= start + 1000 || at >= end - 1000) return this.snapshot()

    const first: Session = {
      ...current,
      endIso: new Date(at).toISOString()
    }
    const second: Session = {
      id: randomUUID(),
      profileSlot: current.profileSlot,
      profileName: current.profileName,
      profileColor: current.profileColor,
      startIso: new Date(at).toISOString(),
      endIso: isLive ? null : current.endIso,
      notes: '',
      notesStatus: 'pending'
    }

    upsertSession(this.config.settings.logDir, first)
    if (isLive) {
      this.active = second
      saveRuntime({ activeSession: second })
    }
    upsertSession(this.config.settings.logDir, second)
    this.emit()
    return this.snapshot()
  }
}
