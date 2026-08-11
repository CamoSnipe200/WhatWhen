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
}

export interface AppConfig {
  profiles: Profile[]
  settings: AppSettings
}

/** UI mode for the expandable orb window */
export type UiMode = 'idle' | 'wheel' | 'stack' | 'bubble' | 'settings'

export interface UiSnapshot {
  mode: UiMode
  activeSession: Session | null
  /** Live elapsed ms for active session */
  elapsedMs: number
  /** Pending sessions oldest → newest */
  pending: Session[]
  /** Session currently edited in bubble */
  bubbleSession: Session | null
  profiles: Profile[]
  hotkeysOk: boolean
  /** Whether today's markdown log file exists */
  todayLogExists: boolean
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

/** Six-slot chromatic palette */
export const DEFAULT_COLORS: string[] = [
  '#FF4D6A', // 1 crimson rose
  '#FF8C42', // 2 orange
  '#FFD166', // 3 gold
  '#8FE388', // 4 spring green
  '#2EC4B6', // 5 teal
  '#5B6CFF' // 6 indigo
]

/** Active profile slots (hotkeys Ctrl+Shift+Alt+1–6) */
export const PROFILE_SLOTS: ProfileSlot[] = [1, 2, 3, 4, 5, 6]

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
