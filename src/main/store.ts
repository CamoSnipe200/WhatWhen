import { existsSync, readFileSync, writeFileSync } from 'fs'
import {
  AppConfig,
  AppSettings,
  DayLog,
  Profile,
  Session,
  computeDayAnalysis,
  defaultProfiles,
  formatDuration,
  formatTimeLocal,
  localDateKey
} from '../shared/types'
import {
  getConfigPath,
  getDayJsonPath,
  getDayMarkdownPath,
  getDefaultLogDir,
  getRuntimeStatePath
} from './paths'

export interface RuntimeState {
  activeSession: Session | null
  /** Sessions still open across days if needed — usually one */
}

function defaultSettings(): AppSettings {
  return {
    logDir: getDefaultLogDir(),
    autostart: false,
    orbSize: 52,
    marginPx: 20,
    orbAnchorX: null,
    orbAnchorY: null
  }
}

export function loadConfig(): AppConfig {
  const path = getConfigPath()
  if (!existsSync(path)) {
    const config: AppConfig = {
      profiles: defaultProfiles(),
      settings: defaultSettings()
    }
    saveConfig(config)
    return config
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AppConfig>
    const profiles = mergeProfiles(raw.profiles)
    const settings = { ...defaultSettings(), ...raw.settings }
    if (!settings.logDir) settings.logDir = getDefaultLogDir()
    if (settings.orbAnchorX === undefined) settings.orbAnchorX = null
    if (settings.orbAnchorY === undefined) settings.orbAnchorY = null
    return { profiles, settings }
  } catch {
    return { profiles: defaultProfiles(), settings: defaultSettings() }
  }
}

function mergeProfiles(saved?: Profile[]): Profile[] {
  const defaults = defaultProfiles()
  if (!saved?.length) return defaults
  // Only keep the six active slots; preserve custom names/colors when present
  return defaults.map((d) => {
    const found = saved.find((p) => p.slot === d.slot)
    return found
      ? {
          slot: d.slot,
          name: found.name?.trim() || d.name,
          color: found.color || d.color
        }
      : d
  })
}

export function saveConfig(config: AppConfig): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
}

export function loadRuntime(): RuntimeState {
  const path = getRuntimeStatePath()
  if (!existsSync(path)) return { activeSession: null }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as RuntimeState
  } catch {
    return { activeSession: null }
  }
}

export function saveRuntime(state: RuntimeState): void {
  writeFileSync(getRuntimeStatePath(), JSON.stringify(state, null, 2), 'utf-8')
}

export function loadDayLog(logDir: string, dateKey = localDateKey()): DayLog {
  const path = getDayJsonPath(logDir, dateKey)
  if (!existsSync(path)) {
    return { date: dateKey, sessions: [] }
  }
  try {
    const log = JSON.parse(readFileSync(path, 'utf-8')) as DayLog
    if (!log.sessions) log.sessions = []
    return log
  } catch {
    return { date: dateKey, sessions: [] }
  }
}

export function saveDayLog(logDir: string, log: DayLog): void {
  const sorted = {
    ...log,
    sessions: [...log.sessions].sort(
      (a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime()
    )
  }
  writeFileSync(getDayJsonPath(logDir, log.date), JSON.stringify(sorted, null, 2), 'utf-8')
  writeFileSync(getDayMarkdownPath(logDir, log.date), renderMarkdown(sorted), 'utf-8')
}

export function upsertSession(logDir: string, session: Session): DayLog {
  const dateKey = localDateKey(new Date(session.startIso))
  const log = loadDayLog(logDir, dateKey)
  const idx = log.sessions.findIndex((s) => s.id === session.id)
  if (idx >= 0) log.sessions[idx] = session
  else log.sessions.push(session)
  saveDayLog(logDir, log)
  return log
}

export function listPending(logDir: string, dateKey = localDateKey()): Session[] {
  const log = loadDayLog(logDir, dateKey)
  return log.sessions
    .filter((s) => s.endIso && s.notesStatus === 'pending')
    .sort((a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime())
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`
}

function renderMarkdown(log: DayLog): string {
  const lines: string[] = [`# WhatWhen — ${log.date}`, '', '## Sessions', '']

  if (log.sessions.length === 0) {
    lines.push('_No sessions yet._', '')
  } else {
    for (const s of log.sessions) {
      const start = formatTimeLocal(s.startIso)
      const end = s.endIso ? formatTimeLocal(s.endIso) : '…'
      const ms =
        s.endIso != null
          ? new Date(s.endIso).getTime() - new Date(s.startIso).getTime()
          : Date.now() - new Date(s.startIso).getTime()
      const dur = formatDuration(ms)
      lines.push(`### ${s.profileName} · ${start} – ${end} (${dur})`)
      lines.push(`- Profile: ${s.profileName}`)
      if (!s.endIso) {
        lines.push(`- Notes: *(in progress)*`)
      } else if (s.notes.trim()) {
        lines.push(`- Notes: ${s.notes.trim()}`)
      } else if (s.notesStatus === 'pending') {
        lines.push(`- Notes: *(pending)*`)
      } else if (s.notesStatus === 'skipped') {
        lines.push(`- Notes: *(skipped)*`)
      } else {
        lines.push(`- Notes:`)
      }
      lines.push('')
    }
  }

  const analysis = computeDayAnalysis(log)
  lines.push('## Analysis', '')
  lines.push(
    `- Tracked: ${formatDuration(analysis.trackedMs)} (${pct(analysis.trackedPercent)} of day)`
  )
  lines.push(
    `- Untracked: ${formatDuration(analysis.untrackedMs)} (${pct(analysis.untrackedPercent)} of day)`
  )
  lines.push('')

  if (analysis.slices.length === 0) {
    lines.push('_No tracked time yet._', '')
  } else {
    lines.push('| Where | Duration | % of day | % of tracked |')
    lines.push('| --- | --- | --- | --- |')
    for (const slice of analysis.slices) {
      const trackedCol =
        slice.profileSlot === null ? '—' : pct(slice.percentOfTracked)
      lines.push(
        `| ${slice.profileName} | ${formatDuration(slice.durationMs)} | ${pct(slice.percentOfDay)} | ${trackedCol} |`
      )
    }
    lines.push('')

    for (const slice of analysis.slices) {
      if (slice.profileSlot === null || slice.notes.length === 0) continue
      lines.push(`### Notes — ${slice.profileName}`, '')
      for (const note of slice.notes) {
        lines.push(`- ${note}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}
