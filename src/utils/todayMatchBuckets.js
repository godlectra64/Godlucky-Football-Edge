import { getMatchStatusInfo } from './matchStatus.js'

export function buildTodayStatusBuckets(matches = []) {
  return (Array.isArray(matches) ? matches : []).reduce((buckets, match) => {
    const status = getMatchStatusInfo(match)
    const row = {
      ...match,
      matchStatusGroup: status.group,
      isFinished: status.isFinished,
      isPlayable: status.isPlayable,
    }
    buckets.allMatches.push(row)
    if (status.isFinished) buckets.finishedMatches.push(row)
    else if (status.isPlayable) buckets.playableMatches.push(row)
    else buckets.notPlayableMatches.push(row)
    return buckets
  }, {
    allMatches: [],
    playableMatches: [],
    finishedMatches: [],
    notPlayableMatches: [],
  })
}
