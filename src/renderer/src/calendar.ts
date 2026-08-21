import type { DateRange, UiSnapshot } from '../../shared/types'
import {
  formatDateKeyLong,
  formatDateKeyShort,
  localDateKey,
  parseDateKey
} from '../../shared/types'

const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function describeView(view: DateRange, todayKey: string): string {
  if (view.startKey === view.endKey) {
    if (view.startKey === todayKey) return 'Today'
    return formatDateKeyShort(view.startKey)
  }
  return `${formatDateKeyShort(view.startKey)} – ${formatDateKeyShort(view.endKey)}`
}

export function emptyStateCopy(args: {
  range: DateRange
  timelineDateKey: string
  viewLogExists: boolean
  isTimeline: boolean
  todayKey: string
}): string {
  const single = args.range.startKey === args.range.endKey
  if (single && args.range.startKey === args.todayKey) {
    return 'No sessions yet today.'
  }
  if (!single && args.isTimeline) {
    return `Nothing tracked on ${formatDateKeyShort(args.timelineDateKey)}. Use ‹ › for other days in this range.`
  }
  if (!single) {
    return `Nothing tracked between ${formatDateKeyShort(args.range.startKey)} and ${formatDateKeyShort(args.range.endKey)}.`
  }
  if (!args.viewLogExists) {
    return `No log for ${formatDateKeyLong(args.range.startKey)}.`
  }
  return `Nothing tracked on ${formatDateKeyLong(args.range.startKey)}.`
}

export function renderDateChip(
  el: HTMLElement,
  view: DateRange,
  todayKey: string
): void {
  el.textContent = describeView(view, todayKey)
}

export interface CalendarPopoverHandlers {
  onPickDay: (dateKey: string) => void
  onExtendTo: (dateKey: string) => void
  onToday: () => void
  onLast7: () => void
  onThisWeek: () => void
  onMonthChange: (month: Date) => void
}

export function renderCalendarPopover(
  root: HTMLElement,
  month: Date,
  snap: UiSnapshot,
  handlers: CalendarPopoverHandlers
): void {
  const todayKey = localDateKey()
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const available = new Set(snap.availableDates)
  const start = snap.view.startKey
  const end = snap.view.endKey

  root.innerHTML = ''

  const head = document.createElement('div')
  head.className = 'cal-head'

  const prev = document.createElement('button')
  prev.type = 'button'
  prev.className = 'overlay-step'
  prev.textContent = '‹'
  prev.setAttribute('aria-label', 'Previous month')
  prev.addEventListener('click', (e) => {
    e.stopPropagation()
    handlers.onMonthChange(new Date(year, monthIndex - 1, 1))
  })

  const label = document.createElement('div')
  label.className = 'cal-month-label'
  label.textContent = `${MONTH_LONG[monthIndex]} ${year}`

  const next = document.createElement('button')
  next.type = 'button'
  next.className = 'overlay-step'
  next.textContent = '›'
  next.setAttribute('aria-label', 'Next month')
  next.addEventListener('click', (e) => {
    e.stopPropagation()
    handlers.onMonthChange(new Date(year, monthIndex + 1, 1))
  })

  head.append(prev, label, next)
  root.appendChild(head)

  const dow = document.createElement('div')
  dow.className = 'cal-dow'
  for (const name of DOW) {
    const cell = document.createElement('div')
    cell.textContent = name
    dow.appendChild(cell)
  }
  root.appendChild(dow)

  const grid = document.createElement('div')
  grid.className = 'cal-grid'

  const cursor = startOfCalendarGrid(year, monthIndex)
  for (let i = 0; i < 42; i++) {
    const key = localDateKey(cursor)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'cal-cell'
    btn.textContent = String(cursor.getDate())
    if (cursor.getMonth() !== monthIndex) btn.classList.add('other-month')
    if (available.has(key)) btn.classList.add('has-log')
    if (key === todayKey) btn.classList.add('is-today')
    if (key >= start && key <= end) btn.classList.add('in-range')
    if (key === start || key === end) btn.classList.add('range-edge')
    if (key > todayKey) {
      btn.classList.add('is-future')
      btn.disabled = true
    } else {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (e.shiftKey) handlers.onExtendTo(key)
        else handlers.onPickDay(key)
      })
    }
    grid.appendChild(btn)
    cursor.setDate(cursor.getDate() + 1)
  }
  root.appendChild(grid)

  const footer = document.createElement('div')
  footer.className = 'cal-footer'

  const todayBtn = document.createElement('button')
  todayBtn.type = 'button'
  todayBtn.className = 'cal-quick'
  todayBtn.textContent = 'Today'
  todayBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    handlers.onToday()
  })

  const last7Btn = document.createElement('button')
  last7Btn.type = 'button'
  last7Btn.className = 'cal-quick'
  last7Btn.textContent = 'Last 7 days'
  last7Btn.addEventListener('click', (e) => {
    e.stopPropagation()
    handlers.onLast7()
  })

  const weekBtn = document.createElement('button')
  weekBtn.type = 'button'
  weekBtn.className = 'cal-quick'
  weekBtn.textContent = 'This week'
  weekBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    handlers.onThisWeek()
  })

  footer.append(todayBtn, last7Btn, weekBtn)
  root.appendChild(footer)
}

export function last7Range(todayKey = localDateKey()): DateRange {
  const end = parseDateKey(todayKey) ?? new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return { startKey: localDateKey(start), endKey: todayKey }
}

export function thisWeekRange(todayKey = localDateKey()): DateRange {
  const today = parseDateKey(todayKey) ?? new Date()
  const dow = today.getDay()
  const delta = dow === 0 ? -6 : 1 - dow
  const monday = new Date(today)
  monday.setDate(today.getDate() + delta)
  return { startKey: localDateKey(monday), endKey: todayKey }
}

function startOfCalendarGrid(year: number, month: number): Date {
  const first = new Date(year, month, 1)
  const dow = first.getDay()
  const mondayOffset = dow === 0 ? -6 : 1 - dow
  const start = new Date(first)
  start.setDate(first.getDate() + mondayOffset)
  return start
}
