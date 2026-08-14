/**
 * Place dots on an arc around the orb (origin at bottom-right of the HWND).
 *
 * Angles: 90 = straight up from the orb, 180 = left of the orb, same height.
 * Tune a ring with radius, startDeg (first item), endDeg (last item), and
 * optional spacingDeg. Omit spacingDeg to pack `count` items evenly
 * from start to end.
 */
export interface RadialArc {
  /** Distance from orb center, px */
  radius: number
  /** First item, degrees */
  startDeg: number
  /** Last item / clamp, degrees */
  endDeg: number
  /**
   * Angular step between consecutive items. When omitted, items are
   * spaced evenly across startDeg…endDeg.
   */
  spacingDeg?: number
}

export interface RadialOrigin {
  right: number
  bottom: number
}

export interface RadialSlot {
  deg: number
  radius: number
  right: number
  bottom: number
}

export function anglesOnArc(
  count: number,
  startDeg: number,
  endDeg: number,
  spacingDeg?: number
): number[] {
  if (count <= 0) return []
  if (count === 1) return [startDeg]
  if (spacingDeg != null && spacingDeg > 0) {
    const out: number[] = []
    for (let i = 0; i < count; i++) {
      const deg = startDeg + i * spacingDeg
      if (deg > endDeg + 0.05) break
      out.push(deg)
    }
    return out
  }
  const step = (endDeg - startDeg) / (count - 1)
  return Array.from({ length: count }, (_, i) => startDeg + i * step)
}

export function placeOnArc(
  count: number,
  arc: RadialArc,
  origin: RadialOrigin,
  dotSize: number
): RadialSlot[] {
  const half = dotSize / 2
  return anglesOnArc(count, arc.startDeg, arc.endDeg, arc.spacingDeg).map(
    (deg) => {
      const rad = (deg * Math.PI) / 180
      return {
        deg,
        radius: arc.radius,
        right: origin.right - Math.cos(rad) * arc.radius - half,
        bottom: origin.bottom + Math.sin(rad) * arc.radius - half
      }
    }
  )
}
