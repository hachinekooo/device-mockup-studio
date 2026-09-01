/** Keep interactive timeline edits on exportable frame boundaries. */
export function snapTimeToFrame(time: number, fps: number, duration: number): number {
  const clamped = Math.min(duration, Math.max(0, time))
  return Math.min(duration, Math.round(clamped * fps) / fps)
}

/**
 * Convert a pointer coordinate within the visible lane — not the label plus
 * lane row — into a deterministic timeline time.
 */
export function timelineTimeAtPointer(
  clientX: number,
  laneLeft: number,
  laneWidth: number,
  duration: number,
  fps: number,
): number {
  if (laneWidth <= 0) return 0
  const ratio = Math.min(1, Math.max(0, (clientX - laneLeft) / laneWidth))
  return snapTimeToFrame(ratio * duration, fps, duration)
}
