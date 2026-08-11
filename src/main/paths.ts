import { app } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync } from 'fs'

export function getAppDataDir(): string {
  const dir = join(app.getPath('userData'), 'WhatWhen')
  ensureDir(dir)
  return dir
}

export function getDefaultLogDir(): string {
  const dir = join(homedir(), 'Documents', 'WhatWhen')
  ensureDir(dir)
  return dir
}

export function getConfigPath(): string {
  return join(getAppDataDir(), 'config.json')
}

export function getRuntimeStatePath(): string {
  return join(getAppDataDir(), 'runtime.json')
}

export function getDayJsonPath(logDir: string, dateKey: string): string {
  ensureDir(logDir)
  return join(logDir, `${dateKey}.json`)
}

export function getDayMarkdownPath(logDir: string, dateKey: string): string {
  ensureDir(logDir)
  return join(logDir, `${dateKey}.md`)
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
