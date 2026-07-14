export const canonicalSelectionWindow = Object.freeze({
  initialHours: 36,
  maximumHours: 48,
  minimumPlayable: 5,
})

export function buildCanonicalSelectionWindow(now = new Date()) {
  const start = new Date(now)
  if (Number.isNaN(start.getTime())) throw new TypeError('Invalid selection window start')
  return {
    start,
    end: new Date(start.getTime() + canonicalSelectionWindow.maximumHours * 60 * 60 * 1000),
    options: {
      now: start,
      windowHours: canonicalSelectionWindow.initialHours,
      maxWindowHours: canonicalSelectionWindow.maximumHours,
      minPlayable: canonicalSelectionWindow.minimumPlayable,
    },
  }
}
