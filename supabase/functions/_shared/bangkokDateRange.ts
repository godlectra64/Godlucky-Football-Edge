const bangkokTimeZone = 'Asia/Bangkok'
const dayMs = 24 * 60 * 60 * 1000

export function getBangkokDayRange(dateInput: Date | string = new Date()) {
  const dateKey = getBangkokDateKey(dateInput)
  const start = new Date(`${dateKey}T00:00:00+07:00`)
  const end = new Date(start.getTime() + dayMs)
  const dateTo = formatBangkokDate(end)

  return {
    dateKey,
    dateFrom: dateKey,
    dateTo,
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
  }
}

function getBangkokDateKey(dateInput: Date | string) {
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime())) return formatBangkokDate(parsed)
  }

  if (dateInput instanceof Date && !Number.isNaN(dateInput.getTime())) {
    return formatBangkokDate(dateInput)
  }

  return formatBangkokDate(new Date())
}

function formatBangkokDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: bangkokTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
