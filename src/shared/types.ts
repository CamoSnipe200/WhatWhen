export type ProfileSlot = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

export type NotesStatus = 'pending' | 'saved' | 'skipped'

export interface Profile {
  slot: ProfileSlot
  name: string
  color: string
  /** Hollow ring of `color`. Slots 8–12 start true. */
  outline: boolean
  /** Bumped on retire. Past sessions keep the epoch they were recorded under. */
  epoch: number
}

export interface Session {
  id: string
  profileSlot: ProfileSlot
  profileName: string
  profileColor: string
  /** Hollow ring of `profileColor`. Absent on older logs → infer from slot. */
  profileOutline?: boolean
  startIso: string
  endIso: string | null
  notes: string
  notesStatus: NotesStatus
  /** Story generation on that slot. Absent on pre-Wave-4 logs → 0. */
  profileEpoch?: number
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
  profileOutline: boolean
  durationMs: number
  percentOfDay: number
  percentOfTracked: number
  notes: string[]
  profileEpoch: number
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

export interface DateRange {
  startKey: string
  endKey: string
}

export interface RangeAnalysis {
  range: DateRange
  days: DayAnalysis[]
  spanMs: number
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
  view: DateRange
  viewIsToday: boolean
  viewIncludesToday: boolean
  /** Whether markdown exists for the timeline day */
  viewLogExists: boolean
  timelineDateKey: string
  viewSessions: Session[]
  viewAnalysis: RangeAnalysis
  availableDates: string[]
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
  10: '10',
  11: '11',
  12: '12',
  0: '0'
}

/** Seed colors for slots 1–12. Slots 8–12 reuse 1–5 as outlines in the UI. */
export const DEFAULT_COLORS: string[] = [
  '#FF4D6A', // 1 crimson rose
  '#FF8C42', // 2 orange
  '#FFD166', // 3 gold
  '#8FE388', // 4 spring green
  '#2EC4B6', // 5 teal
  '#5B6CFF', // 6 indigo
  '#C084FC', // 7 violet
  '#FF4D6A', // 8 outline of 1
  '#FF8C42', // 9 outline of 2
  '#FFD166', // 10 outline of 3
  '#8FE388', // 11 outline of 4
  '#2EC4B6' // 12 outline of 5
]

/** Prior 8–12 seeds. Replaced on load so outline colors match 1–5. */
export const SUPERSEDED_PASTEL_COLORS: string[] = [
  '#FF6F91',
  '#4CAF50',
  '#22B8CF',
  '#A855F7',
  '#9AA5B1',
  '#FFC1CC',
  '#FFD4B8',
  '#FFF3C4',
  '#D4F5D0',
  '#C5F0EB',
  '#FFE6EA',
  '#FFE8D6',
  '#FFF6E0',
  '#E8F8E6',
  '#D6F4F1',
  '#FFCAD2',
  '#FFDCC6',
  '#FFF1D1',
  '#DDF7DB',
  '#C0EDE9',
  '#FFB8C3',
  '#FFD1B3',
  '#FFEDC2',
  '#D2F4CF',
  '#ABE7E2'
]

/** Active profile slots. Hotkeys cover 1–9; 10–12 are wheel-only. */
export const PROFILE_SLOTS: ProfileSlot[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

export const HOTKEY_SLOTS: ProfileSlot[] = PROFILE_SLOTS.filter((s) => s <= 9)

/** Picker palette — unique defaults first, then extras. */
export const PALETTE: string[] = [
  ...DEFAULT_COLORS.slice(0, 7),
  '#E5484D',
  '#FFA94D',
  '#F59F00',
  '#E8D44D',
  '#C0CA33',
  '#2E7D5B',
  '#4DABF7',
  '#3B5BDB',
  '#7048E8',
  '#E879F9',
  '#F06595',
  '#7B8794'
]

/** Shared-color marks in analysis / wheel. 0 = solid. Repeats after 5. */
export const FILL_PATTERN_COUNT = 5

/** Default fill style: slots 8–12 start as outlines of 1–5. */
export function isOutlineSlot(slot: ProfileSlot | number | null | undefined): boolean {
  return slot != null && slot >= 8 && slot <= 12
}

/** Stored outline flag, or the slot default for older records. */
export function isOutlineStyle(source: {
  outline?: boolean
  profileOutline?: boolean
  slot?: ProfileSlot | number
  profileSlot?: ProfileSlot | number | null
}): boolean {
  if (typeof source.outline === 'boolean') return source.outline
  if (typeof source.profileOutline === 'boolean') return source.profileOutline
  return isOutlineSlot(source.slot ?? source.profileSlot)
}

export function isLightProfileColor(c: string): boolean {
  const m = /^#([0-9a-fA-F]{6})$/.exec(c.trim())
  if (!m) return false
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (r + g + b) / 3 >= 200
}

export function normalizeProfileColor(c: unknown, fallback = '#888888'): string {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback
}

export function defaultProfiles(): Profile[] {
  return PROFILE_SLOTS.map((slot, i) => ({
    slot,
    name: `Profile ${SLOT_DISPLAY[slot]}`,
    color: DEFAULT_COLORS[i],
    outline: isOutlineSlot(slot),
    epoch: 0
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

export const MAX_RANGE_DAYS = 31

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function parseDateKey(key: string): Date | null {
  const m = DATE_KEY_RE.exec(key)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return null
  }
  date.setHours(0, 0, 0, 0)
  return date
}

export function isValidDateKey(key: string): boolean {
  if (typeof key !== 'string' || !DATE_KEY_RE.test(key)) return false
  const parsed = parseDateKey(key)
  return parsed !== null && localDateKey(parsed) === key
}

/** Inclusive date keys, oldest first, capped at MAX_RANGE_DAYS. */
export function eachDateKey(startKey: string, endKey: string): string[] {
  const start = parseDateKey(startKey)
  const end = parseDateKey(endKey)
  if (!start || !end) return []
  let a = start
  let b = end
  if (a.getTime() > b.getTime()) {
    a = end
    b = start
  }
  const keys: string[] = []
  const cur = new Date(a)
  while (cur.getTime() <= b.getTime() && keys.length < MAX_RANGE_DAYS) {
    keys.push(localDateKey(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return keys
}

export function clampDateKeyToToday(key: string, now = new Date()): string {
  const today = localDateKey(now)
  if (!isValidDateKey(key)) return today
  return key > today ? today : key
}

export function formatDateKeyShort(key: string): string {
  const d = parseDateKey(key)
  if (!d) return key
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`
}

export function formatDateKeyLong(key: string): string {
  const d = parseDateKey(key)
  if (!d) return key
  return `${WEEKDAY_SHORT[d.getDay()]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`
}

export function profileEpochOf(s: { profileEpoch?: number }): number {
  return Number.isInteger(s.profileEpoch) && (s.profileEpoch as number) >= 0
    ? (s.profileEpoch as number)
    : 0
}

export function profileSliceKey(s: {
  profileSlot: ProfileSlot | null
  profileName: string
  profileEpoch?: number
}): string {
  return `${s.profileSlot}:${profileEpochOf(s)}:${s.profileName}`
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
    profileOutline: boolean
    profileEpoch: number
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
    const key = profileSliceKey(s)
    let acc = byKey.get(key)
    if (!acc) {
      acc = {
        profileSlot: s.profileSlot,
        profileName: s.profileName,
        profileColor: s.profileColor,
        profileOutline: isOutlineStyle(s),
        profileEpoch: profileEpochOf(s),
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
      profileOutline: a.profileOutline,
      durationMs: a.durationMs,
      percentOfDay: (a.durationMs / dayMs) * 100,
      percentOfTracked: trackedMs > 0 ? (a.durationMs / trackedMs) * 100 : 0,
      notes: a.notes,
      profileEpoch: a.profileEpoch
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

export function computeRangeAnalysis(logs: DayLog[], now = new Date()): RangeAnalysis {
  const days = logs.map((log) => computeDayAnalysis(log, now))
  const startKey = logs[0]?.date ?? localDateKey(now)
  const endKey = logs.length > 0 ? logs[logs.length - 1]!.date : startKey

  type Acc = {
    profileSlot: ProfileSlot | null
    profileName: string
    profileColor: string
    profileOutline: boolean
    profileEpoch: number
    durationMs: number
    notes: string[]
  }

  const byKey = new Map<string, Acc>()
  let spanMs = 0
  let trackedMs = 0
  let untrackedMs = 0
  const prefixNotes = logs.length > 1

  for (const day of days) {
    spanMs += day.dayMs
    trackedMs += day.trackedMs
    untrackedMs += day.untrackedMs
    const prefix = prefixNotes ? `${formatDateKeyShort(day.date)} · ` : ''
    for (const slice of day.slices) {
      const key = profileSliceKey(slice)
      let acc = byKey.get(key)
      if (!acc) {
        acc = {
          profileSlot: slice.profileSlot,
          profileName: slice.profileName,
          profileColor: slice.profileColor,
          profileOutline: slice.profileOutline,
          profileEpoch: slice.profileEpoch,
          durationMs: 0,
          notes: []
        }
        byKey.set(key, acc)
      }
      acc.durationMs += slice.durationMs
      if (!acc.profileColor && slice.profileColor) {
        acc.profileColor = slice.profileColor
      }
      for (const note of slice.notes) {
        acc.notes.push(prefix ? `${prefix}${note}` : note)
      }
    }
  }

  const slices: ProfileSlice[] = [...byKey.values()]
    .sort((a, b) => b.durationMs - a.durationMs)
    .map((a) => ({
      profileSlot: a.profileSlot,
      profileName: a.profileName,
      profileColor: a.profileColor,
      profileOutline: a.profileOutline,
      durationMs: a.durationMs,
      percentOfDay: spanMs > 0 ? (a.durationMs / spanMs) * 100 : 0,
      percentOfTracked: trackedMs > 0 ? (a.durationMs / trackedMs) * 100 : 0,
      notes: a.notes,
      profileEpoch: a.profileEpoch
    }))

  return {
    range: { startKey, endKey },
    days,
    spanMs,
    trackedMs,
    untrackedMs,
    trackedPercent: spanMs > 0 ? (trackedMs / spanMs) * 100 : 0,
    untrackedPercent: spanMs > 0 ? (untrackedMs / spanMs) * 100 : 0,
    slices
  }
}
