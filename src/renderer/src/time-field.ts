/** In-overlay time picker. Native `<input type="time">` popups render behind
 *  this always-on-top transparent window, so the list stays in Chromium. */

export type TimeChange = (hhmm: string) => void

let openPop: HTMLElement | null = null
let onDismiss: (() => void) | null = null

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function parseHhmm(value: string): { h: number; m: number } {
  const [hs, ms] = value.split(':')
  const h = Number(hs)
  const m = Number(ms)
  return {
    h: Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 0,
    m: Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0
  }
}

export function formatHhmm(h: number, m: number): string {
  return `${pad2(h)}:${pad2(m)}`
}

export function closeTimePop(): void {
  if (!openPop) return
  const pop = openPop
  const fn = onDismiss
  openPop = null
  onDismiss = null
  pop.hidden = true
  fn?.()
}

export function isTimePopOpen(): boolean {
  return openPop !== null
}

function markSelected(col: HTMLElement, value: number): void {
  for (const opt of col.querySelectorAll<HTMLElement>('.time-opt')) {
    opt.classList.toggle('is-selected', Number(opt.dataset.value) === value)
  }
}

function fillCol(col: HTMLElement, count: number, selected: number, onPick: (n: number) => void): void {
  col.innerHTML = ''
  for (let n = 0; n < count; n++) {
    const opt = document.createElement('button')
    opt.type = 'button'
    opt.className = 'time-opt'
    opt.dataset.value = String(n)
    opt.textContent = pad2(n)
    if (n === selected) opt.classList.add('is-selected')
    opt.addEventListener('click', (e) => {
      e.stopPropagation()
      onPick(n)
    })
    col.appendChild(opt)
  }
}

function scrollSelected(col: HTMLElement): void {
  const sel = col.querySelector<HTMLElement>('.is-selected')
  if (!sel) return
  col.scrollTop = sel.offsetTop - col.clientHeight / 2 + sel.offsetHeight / 2
}

export function createTimeField(opts: {
  valueHhmm: string
  disabled?: boolean
  onChange: TimeChange
}): HTMLElement {
  const root = document.createElement('div')
  root.className = 'time-field'
  const initial = parseHhmm(opts.valueHhmm)
  let h = initial.h
  let m = initial.m

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'time-field-btn'
  btn.disabled = !!opts.disabled
  btn.textContent = formatHhmm(h, m)

  const pop = document.createElement('div')
  pop.className = 'time-pop'
  pop.hidden = true
  const hourCol = document.createElement('div')
  hourCol.className = 'time-col'
  const minCol = document.createElement('div')
  minCol.className = 'time-col'
  pop.append(hourCol, minCol)

  const paint = (): void => {
    btn.textContent = formatHhmm(h, m)
    markSelected(hourCol, h)
    markSelected(minCol, m)
  }

  fillCol(hourCol, 24, h, (n) => {
    h = n
    paint()
  })
  fillCol(minCol, 60, m, (n) => {
    m = n
    paint()
  })

  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (btn.disabled) return
    if (openPop === pop) {
      closeTimePop()
      return
    }
    closeTimePop()
    pop.hidden = false
    openPop = pop
    onDismiss = () => {
      const next = formatHhmm(h, m)
      if (next !== formatHhmm(initial.h, initial.m)) opts.onChange(next)
    }
    scrollSelected(hourCol)
    scrollSelected(minCol)
  })

  pop.addEventListener('click', (e) => e.stopPropagation())
  root.append(btn, pop)
  return root
}
