export type ProfileSlot = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type NotesStatus = 'pending' | 'saved' | 'skipped'

export interface Profile {
  slot: ProfileSlot
  name: string
  color: string
}

export interface Session {
  id: string
  profileSlot: ProfileSlot
  profileName: string
  profileColor: string
  startIso: string
  endIso: string | null
  notes: string
  notesStatus: NotesStatus
}

export interface DayLog {
  date: string
  sessions: Session[]
}

export interface AppSettings {
  logDir: string
  autostart: boolean
  orbSize: number
  marginPx: number
  /** Absolute screen X of the orb window's bottom-right corner */
  orbAnchorX: number | null
  /** Absolute screen Y of the orb window's bottom-right corner */
  orbAnchorY: number | null
}

export interface AppConfig {
  profiles: Profile[]
  settings: AppSettings
}

/** UI mode for the expandable orb window */
export type UiMode =
  | 'idle'
  | 'wheel'
  | 'stack'
  | 'bubble'
  | 'settings'
  | 'analysis'
  | 'timeline'

export interface ProfileSlice {
  profileSlot: ProfileSlot | null
  profileName: string
  profileColor: string
  durationMs: number
  percentOfDay: number
  percentOfTracked: number
  notes: string[]
}

export interface DayAnalysis {
  date: string
  dayStartIso: string
  dayEndIso: string
  dayMs: number
  trackedMs: number
  untrackedMs: number
  trackedPercent: number
  untrackedPercent: number
  slices: ProfileSlice[]
}

export interface UiSnapshot {
  mode: UiMode
  activeSession: Session | null
  /** Live elapsed ms for active session */
  elapsedMs: number
  /** Pending sessions oldest → newest */
  pending: Session[]
  /** Session currently edited in bubble */
  bubbleSession: Session | null
  /** True when bubble was opened from the pending backlog (not a fresh switch/stop) */
  bubbleFromBacklog: boolean
  profiles: Profile[]
  hotkeysOk: boolean
  /** Whether today's markdown log file exists */
  todayLogExists: boolean
  /** Today's sessions for timeline / analysis overlays */
  todaySessions: Session[]
  /** Precomputed day analysis (today) */
  analysis: DayAnalysis | null
}

export interface PromptPayload {
  session: Session
}

export const SLOT_DISPLAY: Record<ProfileSlot, string> = {
  1: '1',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  0: '0'
}

/** Seven-slot chromatic palette */
export const DEFAULT_COLORS: string[] = [
  '#FF4D6A', // 1 crimson rose
  '#FF8C42', // 2 orange
  '#FFD166', // 3 gold
  '#8FE388', // 4 spring green
  '#2EC4B6', // 5 teal
  '#5B6CFF', // 6 indigo
  '#C084FC' // 7 violet
]

/** Active profile slots (hotkeys Ctrl+Shift+Alt+1–7) */
export const PROFILE_SLOTS: ProfileSlot[] = [1, 2, 3, 4, 5, 6, 7]

export function defaultProfiles(): Profile[] {
  return PROFILE_SLOTS.map((slot, i) => ({
    slot,
    name: `Profile ${SLOT_DISPLAY[slot]}`,
    color: DEFAULT_COLORS[i]
  }))
}

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatTimeLocal(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function localDateKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Start of local calendar day for a date key or Date */
export function dayStart(d = new Date()): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

/** End of analysis window: now for today, else end of that calendar day */
export function dayEndFor(dateKey: string, now = new Date()): Date {
  if (dateKey === localDateKey(now)) return now
  const [y, m, day] = dateKey.split('-').map(Number)
  const end = new Date(y, m - 1, day, 23, 59, 59, 999)
  return end
}

export function computeDayAnalysis(
  log: DayLog,
  now = new Date()
): DayAnalysis {
  const start = dayStart(
    (() => {
      const [y, m, day] = log.date.split('-').map(Number)
      return new Date(y, m - 1, day)
    })()
  )
  const end = dayEndFor(log.date, now)
  const dayMs = Math.max(1, end.getTime() - start.getTime())

  type Acc = {
    profileSlot: ProfileSlot | null
    profileName: string
    profileColor: string
    durationMs: number
    notes: string[]
  }

  const byKey = new Map<string, Acc>()
  let trackedMs = 0

  for (const s of log.sessions) {
    const sStart = Math.max(new Date(s.startIso).getTime(), start.getTime())
    const sEndRaw = s.endIso ? new Date(s.endIso).getTime() : now.getTime()
    const sEnd = Math.min(sEndRaw, end.getTime())
    const dur = Math.max(0, sEnd - sStart)
    if (dur <= 0) continue
    trackedMs += dur
    const key = `${s.profileSlot}:${s.profileName}`
    let acc = byKey.get(key)
    if (!acc) {
      acc = {
        profileSlot: s.profileSlot,
        profileName: s.profileName,
        profileColor: s.profileColor,
        durationMs: 0,
        notes: []
      }
      byKey.set(key, acc)
    }
    acc.durationMs += dur
    const note = s.notes.trim()
    if (note) acc.notes.push(note)
    else if (s.notesStatus === 'pending') acc.notes.push('(pending)')
  }

  const untrackedMs = Math.max(0, dayMs - trackedMs)
  const slices: ProfileSlice[] = [...byKey.values()]
    .sort((a, b) => b.durationMs - a.durationMs)
    .map((a) => ({
      profileSlot: a.profileSlot,
      profileName: a.profileName,
      profileColor: a.profileColor,
      durationMs: a.durationMs,
      percentOfDay: (a.durationMs / dayMs) * 100,
      percentOfTracked: trackedMs > 0 ? (a.durationMs / trackedMs) * 100 : 0,
      notes: a.notes
    }))

  return {
    date: log.date,
    dayStartIso: start.toISOString(),
    dayEndIso: end.toISOString(),
    dayMs,
    trackedMs,
    untrackedMs,
    trackedPercent: (trackedMs / dayMs) * 100,
    untrackedPercent: (untrackedMs / dayMs) * 100,
    slices
  }
}
