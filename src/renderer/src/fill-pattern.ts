import { FILL_PATTERN_COUNT, type ProfileSlot } from '../../shared/types'

const NS = 'http://www.w3.org/2000/svg'
const MARK = 'rgba(255, 255, 255, 0.55)'

export type FillGroupItem = {
  color: string
  id: string
  slot: ProfileSlot | number | null
}

/**
 * Marks only when the same slot reused a color after retire.
 * A fill and an outline of the same hue on different slots stay unmarked.
 */
export function fillPatternIndex(
  color: string,
  slot: ProfileSlot | number | null | undefined,
  group: readonly FillGroupItem[],
  id: string
): number {
  const c = color.toLowerCase()
  let n = 0
  for (const item of group) {
    if (item.color.toLowerCase() !== c) continue
    if (item.slot !== slot) continue
    if (item.id === id) return n % FILL_PATTERN_COUNT
    n++
  }
  return 0
}

export function setFillPattern(el: HTMLElement, index: number): void {
  if (index <= 0) {
    delete el.dataset.fillPattern
    return
  }
  el.dataset.fillPattern = String(index)
}

function ensureDefs(svg: SVGSVGElement): SVGDefsElement {
  const found = svg.querySelector('defs')
  if (found) return found
  const defs = document.createElementNS(NS, 'defs')
  svg.prepend(defs)
  return defs
}

function hatch(pat: SVGPatternElement, x1: number, y1: number, x2: number, y2: number): void {
  const line = document.createElementNS(NS, 'line')
  line.setAttribute('x1', String(x1))
  line.setAttribute('y1', String(y1))
  line.setAttribute('x2', String(x2))
  line.setAttribute('y2', String(y2))
  line.setAttribute('stroke', MARK)
  line.setAttribute('stroke-width', '1.25')
  pat.appendChild(line)
}

/** Returns a CSS/SVG fill. Pattern 0 is the solid color. */
export function svgFillForPattern(
  svg: SVGSVGElement,
  color: string,
  index: number,
  id: string
): string {
  if (index <= 0) return color
  const pat = document.createElementNS(NS, 'pattern')
  pat.id = id
  pat.setAttribute('patternUnits', 'userSpaceOnUse')
  pat.setAttribute('width', '8')
  pat.setAttribute('height', '8')

  const bg = document.createElementNS(NS, 'rect')
  bg.setAttribute('width', '8')
  bg.setAttribute('height', '8')
  bg.setAttribute('fill', color)
  pat.appendChild(bg)

  if (index === 1) {
    for (const [cx, cy] of [
      [2, 2],
      [6, 6]
    ]) {
      const dot = document.createElementNS(NS, 'circle')
      dot.setAttribute('cx', String(cx))
      dot.setAttribute('cy', String(cy))
      dot.setAttribute('r', '1.15')
      dot.setAttribute('fill', MARK)
      pat.appendChild(dot)
    }
  } else if (index === 2) {
    hatch(pat, 0, 8, 8, 0)
  } else if (index === 3) {
    hatch(pat, 0, 0, 8, 8)
  } else {
    hatch(pat, 0, 8, 8, 0)
    hatch(pat, 0, 0, 8, 8)
  }

  ensureDefs(svg).appendChild(pat)
  return `url(#${id})`
}
