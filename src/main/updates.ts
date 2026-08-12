import {
  app,
  dialog,
  shell,
  type BrowserWindow,
  type MessageBoxOptions,
  type MessageBoxReturnValue
} from 'electron'

const GITHUB_OWNER = 'CamoSnipe200'
const GITHUB_REPO = 'WhatWhen'
const LATEST_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

type GhAsset = {
  name: string
  browser_download_url: string
}

type GhRelease = {
  tag_name: string
  html_url: string
  assets: GhAsset[]
}

/** Compare dotted versions (optional leading `v`). 1 = a>b, 0 = equal, -1 = a<b */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((p) => parseInt(p, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((p) => parseInt(p, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}

function pickSetupAsset(assets: GhAsset[]): GhAsset | undefined {
  const exes = assets.filter((a) => /\.exe$/i.test(a.name))
  return (
    exes.find((a) => /setup/i.test(a.name)) ??
    exes.find((a) => !/portable/i.test(a.name)) ??
    exes[0]
  )
}

async function fetchLatestRelease(): Promise<GhRelease> {
  const res = await fetch(LATEST_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'WhatWhen'
    }
  })
  if (!res.ok) {
    throw new Error(`GitHub release check failed (${res.status})`)
  }
  return (await res.json()) as GhRelease
}

function showBox(
  parent: BrowserWindow | null,
  options: MessageBoxOptions
): Promise<MessageBoxReturnValue> {
  if (parent && !parent.isDestroyed()) {
    return dialog.showMessageBox(parent, options)
  }
  return dialog.showMessageBox(options)
}

/**
 * Manual update check: compare app version to GitHub latest release.
 * If newer, offer to open the NSIS Setup download in the browser.
 */
export async function checkForUpdates(
  parent: BrowserWindow | null
): Promise<void> {
  const current = app.getVersion()

  try {
    const release = await fetchLatestRelease()
    const latest = release.tag_name
    const newer = compareVersions(latest, current) > 0

    if (!newer) {
      await showBox(parent, {
        type: 'info',
        title: 'WhatWhen',
        message: "You're up to date",
        detail: `Version ${current} is the latest release.`,
        buttons: ['OK'],
        defaultId: 0,
        noLink: true
      })
      return
    }

    const setup = pickSetupAsset(release.assets ?? [])
    const downloadUrl = setup?.browser_download_url ?? release.html_url
    const { response } = await showBox(parent, {
      type: 'info',
      title: 'WhatWhen',
      message: `Version ${latest.replace(/^v/i, '')} is available`,
      detail: `You have ${current}. Download the installer and run it to update.`,
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })

    if (response === 0) {
      await shell.openExternal(downloadUrl)
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    await showBox(parent, {
      type: 'warning',
      title: 'WhatWhen',
      message: "Couldn't check for updates",
      detail,
      buttons: ['OK'],
      defaultId: 0,
      noLink: true
    })
  }
}
