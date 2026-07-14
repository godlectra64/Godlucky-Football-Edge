export const nearKickoffWindows = Object.freeze([90, 60, 30, 15])

export function getNearKickoffWindow(kickoffAt, now = new Date()) {
  const kickoff = new Date(kickoffAt).getTime()
  const current = new Date(now).getTime()
  if (!Number.isFinite(kickoff) || !Number.isFinite(current) || current >= kickoff) return null
  const minutes = Math.ceil((kickoff - current) / 60_000)
  return nearKickoffWindows.find((window) => minutes >= window && minutes < window + 15) ?? null
}

export function buildNearKickoffExecutionKey(matchId, kickoffAt, windowMinutes) {
  return [matchId, new Date(kickoffAt).toISOString(), `T-${windowMinutes}`].join('|')
}
