import { PALETTE } from '../../shared/types'

export function renderPaletteGrid(
  root: HTMLElement,
  opts: {
    selected: string
    selectedOutline: boolean
    onPick: (color: string, outline: boolean) => void
  }
): void {
  const grid = document.createElement('div')
  grid.className = 'palette-grid'
  const selected = opts.selected.toLowerCase()

  for (const color of PALETTE) {
    for (const outline of [false, true]) {
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'palette-cell'
      cell.style.setProperty('--c', color)
      if (outline) {
        cell.classList.add('is-outline')
      } else {
        cell.style.background = color
      }
      if (color.toLowerCase() === selected && outline === opts.selectedOutline) {
        cell.classList.add('is-selected')
      }
      cell.addEventListener('click', (e) => {
        e.stopPropagation()
        opts.onPick(color, outline)
      })
      grid.appendChild(cell)
    }
  }

  root.appendChild(grid)
}
