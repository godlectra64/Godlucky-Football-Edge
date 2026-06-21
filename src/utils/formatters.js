export function formatThaiDate(dateString = new Date().toISOString()) {
  return new Intl.DateTimeFormat('th-TH', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dateString))
}

export function formatShortDate(dateString) {
  if (!dateString) return '-'
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(dateString))
}

export function formatKickoffTime(dateString) {
  if (!dateString) return '-'
  return new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateString))
}

export function formatUpdatedAt(dateString) {
  if (!dateString) return 'รอ sync'
  return new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  }).format(new Date(dateString))
}

export function formatScore(homeGoals, awayGoals) {
  if (homeGoals === null || homeGoals === undefined || awayGoals === null || awayGoals === undefined) return 'ยังไม่จบ'
  return `${homeGoals}-${awayGoals}`
}

export function nowTime() {
  return new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())
}

export function clampScore(value, max = 10) {
  const numeric = Number(value)
  if (Number.isNaN(numeric)) return 0
  return Math.max(0, Math.min(max, numeric))
}
