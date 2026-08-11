import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import {
  Profile,
  ProfileSlot,
  Session,
  UiSnapshot,
  formatDuration,
  localDateKey
} from '../shared/types'
import {
  AppConfig,
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
    const pending = listPending(this.config.settings.logDir)
    return {
      mode: this.mode,
      activeSession: this.active,
      elapsedMs: this.active
        ? Date.now() - new Date(this.active.startIso).getTime()
        : 0,
      pending,
      bubbleSession: this.bubbleSession,
      profiles: this.config.profiles,
      hotkeysOk: this.hotkeysOk,
      todayLogExists: this.todayLogExists()
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
      this.mode = 'bubble'
    } else {
      this.mode = 'idle'
      this.bubbleSession = null
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
      this.mode = 'bubble'
    } else {
      this.mode = 'idle'
      this.bubbleSession = null
    }
    this.emit()
    return this.snapshot()
  }

  private endActiveSession(): Session | null {
    if (!this.active || this.active.endIso) return null
    const endIso = new Date().toISOString()
    // Notes written in the bubble; dismiss always saves (see saveNotes / bubbleEscape)
    const closed: Session = {
      ...this.active,
      endIso,
      notes: '',
      notesStatus: 'pending' // only until bubble is dismissed
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
    this.emit()
    return this.snapshot()
  }

  openStack(): UiSnapshot {
    this.mode = 'stack'
    this.bubbleSession = null
    this.emit()
    return this.snapshot()
  }

  openSettings(): UiSnapshot {
    this.mode = 'settings'
    this.bubbleSession = null
    this.emit()
    return this.snapshot()
  }

  closeUi(): UiSnapshot {
    // Leaving the bubble via any close path saves empty/current as saved
    if (this.mode === 'bubble' && this.bubbleSession) {
      this.persistNotes(this.bubbleSession.id, this.bubbleSession.notes || '')
    }
    this.mode = 'idle'
    this.bubbleSession = null
    this.emit()
    return this.snapshot()
  }

  openBubble(sessionId: string): UiSnapshot {
    const pending = listPending(this.config.settings.logDir)
    const session = pending.find((s) => s.id === sessionId)
    if (session) {
      this.bubbleSession = session
      this.mode = 'bubble'
    }
    this.emit()
    return this.snapshot()
  }

  saveNotes(sessionId: string, notes: string): UiSnapshot {
    this.persistNotes(sessionId, notes)
    this.bubbleSession = null
    this.mode = 'idle'
    this.emit()
    return this.snapshot()
  }

  /**
   * Leaving the bubble always saves (empty notes are fine).
   * No more stuck "pending" unless the process died mid-session.
   */
  bubbleEscape(): UiSnapshot {
    if (this.bubbleSession) {
      this.persistNotes(this.bubbleSession.id, '')
    }
    this.bubbleSession = null
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

  /** Save bubble with current draft text then close */
  dismissBubbleWithNotes(notes: string): UiSnapshot {
    if (this.bubbleSession) {
      this.persistNotes(this.bubbleSession.id, notes)
    }
    this.bubbleSession = null
    this.mode = 'idle'
    this.emit()
    return this.snapshot()
  }

  stackEscape(): UiSnapshot {
    this.mode = 'idle'
    this.bubbleSession = null
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
    if (this.mode === 'settings' || this.mode === 'stack') {
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
}
