const bangkokTimeZone = 'Asia/Bangkok'
const dayMs = 24 * 60 * 60 * 1000

export function getBangkokToday() {
  return formatBangkokDate(new Date())
}

export function formatBangkokDate(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: bangkokTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(Number.isNaN(value.getTime()) ? new Date() : value)
}

export function getBangkokDateRange(date = new Date()) {
  const dateKey = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : formatBangkokDate(date)
  const start = new Date(`${dateKey}T00:00:00+07:00`)
  const end = new Date(start.getTime() + dayMs)
  return {
    dateKey,
    dateFrom: dateKey,
    dateTo: formatBangkokDate(end),
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
  }
}
