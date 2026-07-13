import { isFinishedStatus, isScheduledStatus, isVoidStatus, normalizeStatusCode } from './matchStatus.js'

export function settleAiPickResult(input = {}) {
  const statusShort = normalizeStatusCode(input.statusShort ?? input.status_short ?? input.status)
  const homeScore = nullableNumber(input.homeScore ?? input.home_score ?? input.homeGoals ?? input.home_goals)
  const awayScore = nullableNumber(input.awayScore ?? input.away_score ?? input.awayGoals ?? input.away_goals)

  if (isVoidStatus(statusShort)) {
    return {
      settlement_status: 'VOID',
      simulation_outcome: 'VOID',
      settlement_reason: `void match status ${statusShort}`,
    }
  }

  if (isScheduledStatus(statusShort) || !isFinishedStatus(statusShort)) {
    return {
      settlement_status: 'PENDING',
      simulation_outcome: 'PENDING',
      settlement_reason: `match status ${statusShort} is not finished`,
    }
  }

  if (homeScore === null || awayScore === null) {
    return {
      settlement_status: 'PENDING',
      simulation_outcome: 'PENDING',
      settlement_reason: 'finished match is missing score',
    }
  }

  const market = normalizeMarket(input.marketFocus ?? input.market_focus)
  const direction = normalizeDirection(input.direction)
  const line = nullableNumber(input.line ?? input.marketLine ?? input.market_line ?? input.handicap ?? input.totalLine ?? input.total_line)

  if (market === 'MATCH_WINNER') return settleMatchWinner(direction, homeScore, awayScore)
  if (market === 'OU') return line === null ? voidOutcome('finished OU pick is missing line') : settleTotal(direction, line, homeScore + awayScore)
  if (market === 'AH') return line === null ? voidOutcome('finished AH pick is missing line') : settleAsianHandicap(direction, line, homeScore, awayScore)

  return voidOutcome(`unsupported market ${market || 'UNKNOWN'}`)
}

function settleMatchWinner(direction, homeScore, awayScore) {
  const result = homeScore > awayScore ? 'HOME' : homeScore < awayScore ? 'AWAY' : 'DRAW'
  if (!['HOME', 'AWAY', 'DRAW'].includes(direction)) return voidOutcome('match winner pick is missing direction')
  return settled(direction === result ? 'HIT' : 'MISS', `MATCH_WINNER ${direction} vs result ${result}`)
}

function settleTotal(direction, line, total) {
  if (!['OVER', 'UNDER'].includes(direction)) return voidOutcome('OU pick is missing OVER/UNDER direction')
  if (total === line) return settled('PUSH', `OU ${direction} ${line} total ${total}`)
  const hit = direction === 'OVER' ? total > line : total < line
  return settled(hit ? 'HIT' : 'MISS', `OU ${direction} ${line} total ${total}`)
}

function settleAsianHandicap(direction, line, homeScore, awayScore) {
  if (!['HOME', 'AWAY'].includes(direction)) return voidOutcome('AH pick is missing HOME/AWAY direction')
  const margin = direction === 'HOME' ? homeScore - awayScore : awayScore - homeScore
  const adjusted = margin + line
  if (adjusted === 0) return settled('PUSH', `AH ${direction} ${line} margin ${margin}`)
  return settled(adjusted > 0 ? 'HIT' : 'MISS', `AH ${direction} ${line} margin ${margin}`)
}

function settled(simulation_outcome, settlement_reason) {
  return { settlement_status: 'SETTLED', simulation_outcome, settlement_reason }
}

function voidOutcome(settlement_reason) {
  return { settlement_status: 'VOID', simulation_outcome: 'VOID', settlement_reason }
}

function normalizeMarket(value) {
  return String(value ?? '').trim().toUpperCase()
}

function normalizeDirection(value) {
  const text = String(value ?? '').trim().toUpperCase()
  if (text.includes('OVER')) return 'OVER'
  if (text.includes('UNDER')) return 'UNDER'
  if (text.includes('HOME') || text.includes('เจ้าบ้าน')) return 'HOME'
  if (text.includes('AWAY') || text.includes('ทีมเยือน')) return 'AWAY'
  if (text.includes('DRAW')) return 'DRAW'
  return text
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}
