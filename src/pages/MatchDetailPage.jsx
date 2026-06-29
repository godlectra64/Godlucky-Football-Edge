import { useState } from 'react'
import { Activity, ArrowLeft, Brain, CalendarClock, Clock, Gauge, ListChecks, MapPin, ShieldAlert, Sparkles, Star, TrendingUp, Users } from 'lucide-react'
import AiFinalPickCard from '../components/AiFinalPickCard'
import RiskBadge from '../components/RiskBadge'
import ScoreBadge from '../components/ScoreBadge'
import {
  buildAiVerdict,
  buildRiskFactors,
  getRiskLabel,
  normalizeDetailPayload,
  splitSummary,
} from '../utils/matchDetail'
import { formatKickoffTime, formatScore } from '../utils/formatters'
import { calculateDataCoverage, normalizeDataPlatform } from '../utils/dataPlatform'
import { buildExplainableAi } from '../utils/explainableAi'
import { normalizeMarketIntelligence } from '../utils/marketIntelligence'

const moduleSubtitles = {
  'Team Strength': 'Squad quality',
  'Recent Form': 'Current run',
  'Goal Scoring': 'Chance creation',
  'Defensive Stability': 'Resistance',
  'Home Advantage': 'Venue edge',
  'Away Weakness': 'Opponent vulnerability',
  'Motivation & Context': 'Match context',
  'Market Risk': 'Price movement',
  'Overall Risk': 'Total volatility',
}

export default function MatchDetailPage({ match, oneBestPick = null, loading = false, error = '', performanceContext = 'Collecting data', predictionReliability = null, onBack, onGoToday }) {
  if (loading) {
    return (
      <main className="app-page theme-analysis">
        <BackButton onBack={onBack} />
        <StatePanel title="Loading match intelligence" message="Reading fixture, analysis modules, and reliability context." icon={Brain} />
      </main>
    )
  }

  if (error) {
    return (
      <main className="app-page theme-analysis">
        <BackButton onBack={onBack} />
        <StatePanel title="Unable to load analysis" message={error} tone="error" icon={ShieldAlert} />
      </main>
    )
  }

  if (!match) {
    return (
      <main className="app-page theme-analysis">
        <StatePanel title="No match selected" message="Choose a fixture from Today to open the professional analysis board." icon={Sparkles}>
          <button type="button" onClick={onGoToday} className="premium-button mt-4 px-5">
            Back to Today
          </button>
        </StatePanel>
      </main>
    )
  }

  const detail = normalizeDetailPayload(match)
  const heroSelection = oneBestPick?.match && String(oneBestPick.match.id) === String(detail.id) && oneBestPick.heroType !== 'NO_CLEAR_PICK' ? oneBestPick : null
  const verdict = buildAiVerdict(detail)
  const riskFactors = buildRiskFactors(detail)
  const riskLabel = getRiskLabel(detail.riskLevel)
  const platform = normalizeDataPlatform({ match: detail, analysis: detail.analysis })
  const explainability = buildExplainableAi(platform)
  const dataCoverage = calculateDataCoverage(platform)
  const marketIntelligence = normalizeMarketIntelligence(detail)

  return (
    <main className="app-page theme-analysis">
      <BackButton onBack={onBack} />
      <HeroHeader detail={detail} />
      <FinalDecisionSection detail={detail} heroSelection={heroSelection} />
      <AiFinalPickAnalysisSection detail={detail} />
      <AiSelectionBreakdownSection detail={detail} />
      <DataIntelligenceV4Section detail={detail} />
      <FootballEnrichmentSection detail={detail} />
      <AiVerdictSection detail={detail} verdict={verdict} />
      <ScoreBreakdownSection items={detail.moduleItems} />
      <ExplainableAiSection explanation={explainability} />
      <FootballIntelligenceSection intelligence={detail.footballIntelligence} />
      <FootballDataIntelligenceSection items={detail.dataIntelligenceItems} />
      <ContextSection title="AI Performance Context" icon={Star} body={performanceContext || 'Collecting data'} />
      <PredictionReliabilitySection reliability={predictionReliability} />
      <RiskAnalysisSection detail={detail} riskLabel={riskLabel} riskFactors={riskFactors} />
      <RankingSection detail={detail} />
      <DataQualitySection dataQuality={detail.dataQuality} />
      <DataPlatformCoverageSection coverage={dataCoverage} />
      <MarketIntelligenceSection market={marketIntelligence} />
      <SummarySection detail={detail} />
    </main>
  )
}

function BackButton({ onBack }) {
  return (
    <button type="button" onClick={onBack} className="premium-button premium-focus mb-3 flex min-h-11 items-center gap-2 px-3 text-sm">
      <ArrowLeft size={18} />
      Today
    </button>
  )
}

function HeroHeader({ detail }) {
  const rankContext = detail.aiPickLabel ?? (detail.rank ? `AI PICK #${detail.rank}` : detail.rankingScore ? 'Top board match' : 'Analysis board')
  const venue = getVenueText(detail)

  return (
    <section className="premium-hero p-4">
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="eyebrow flex items-center gap-1.5">
              <Brain size={14} />
              Match Analysis Board
            </p>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-bold text-slate-400">
              <CalendarClock size={14} className="shrink-0" />
              <span className="truncate">{detail.league?.name ?? 'Unknown league'} · {formatKickoffTime(detail.kickoffAt)}</span>
            </p>
          </div>
          <span className="semantic-badge border-amber-300/40 bg-amber-300/10 text-amber-100">{rankContext}</span>
        </div>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_34px_minmax(0,1fr)] items-center gap-2">
          <TeamBlock team={detail.homeTeam} align="left" />
          <div className="text-center text-xs font-black text-slate-500">VS</div>
          <TeamBlock team={detail.awayTeam} align="right" />
        </div>

        <div className="mt-4 rounded-2xl border border-blue-300/25 bg-blue-300/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase text-blue-200/80">AI Decision</p>
              <div className="mt-1 flex items-center gap-2">
                <ScoreBadge recommendation={detail.recommendation} />
                <RiskBadge level={detail.riskLevel} />
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-black uppercase text-slate-400">Confidence</p>
              <p className="text-3xl font-black leading-8 text-white">{detail.confidence}%</p>
            </div>
          </div>
          <div className="progress-bar mt-3">
            <span style={{ width: `${Math.max(4, Math.min(100, detail.confidence ?? 0))}%` }} />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Metric label="Edge" value={detail.rankingScore ? `${detail.rankingScore}` : '-'} />
          <Metric label="Status" value={detail.status ?? '-'} />
          <Metric label="Score" value={formatScore(detail.homeGoals, detail.awayGoals)} />
        </div>
        <p className="mt-3 text-clamp-1 text-xs font-semibold text-slate-500">{venue || 'Venue data pending'}</p>
      </div>
    </section>
  )
}

function AiFinalPickAnalysisSection({ detail }) {
  return (
    <Section title="AI Final Pick Analysis" icon={Brain} accent>
      <AiFinalPickCard match={detail} defaultOpen />
    </Section>
  )
}

function AiVerdictSection({ detail, verdict }) {
  return (
    <Section title="AI Decision" icon={Sparkles} accent>
      <div className="rounded-2xl border border-blue-300/25 bg-blue-300/10 p-3">
        <div className="flex items-center justify-between gap-3">
          <ScoreBadge recommendation={verdict.verdict} />
          <span className="text-sm font-black text-blue-100">{detail.confidence}% confidence</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-200">{detail.rankReason}</p>
      </div>
      <TwoColumnLists leftTitle="Reasons" leftItems={verdict.reasons} rightTitle="Cautions" rightItems={verdict.cautions} />
      <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">{verdict.playable}</p>
    </Section>
  )
}

function FinalDecisionSection({ detail, heroSelection }) {
  const finalPick = detail.finalPick

  return (
    <Section title="AI FINAL DECISION" icon={Sparkles} accent>
      <div className={`rounded-2xl border p-3 ${finalDecisionClass(finalPick)}`}>
        {heroSelection ? (
          <div className="mb-3 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-2.5">
            <span className="semantic-badge border-amber-300/35 bg-amber-300/12 text-amber-50">ตัวเลือกหลักของวันนี้</span>
            <p className="mt-2 text-sm font-bold leading-6 text-amber-50">{heroSelection.subtitle}</p>
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase text-slate-400">AI เลือก</p>
            <p className={`mt-1 text-clamp-2 text-2xl font-black leading-7 ${finalPick.canHighlight ? 'text-white' : 'text-slate-300'}`}>
              {finalPick.canHighlight ? finalPick.pickTeam : finalPick.pickLabel}
            </p>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-300">{finalPick.pickReason}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <ScoreBadge recommendation={finalPick.recommendation} />
            <RiskBadge level={finalPick.riskLevel} />
            <span className="semantic-badge border-white/10 bg-white/[0.05] text-white">{finalPick.confidence}%</span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <DecisionMetric label="Market" value={finalPick.marketTypeLabel} muted={!finalPick.marketType} />
          <DecisionMetric label="Line" value={finalPick.marketLineLabel} muted={!finalPick.marketLine} />
          <DecisionMetric label={finalPick.probabilitySource === 'confidence_estimate' ? 'Model Probability' : 'Win Probability'} value={finalPick.probabilityLabel} />
          <DecisionMetric label="Fair Line" value={finalPick.fairLineLabel} muted={!finalPick.fairLine} />
          <DecisionMetric label="Value" value={finalPick.valueStatusLabel} muted={finalPick.valueStatus !== 'YES'} />
          <DecisionMetric label="Reason" value={finalPick.valueReason} muted={finalPick.valueStatus !== 'YES'} />
        </div>
        <p className="text-clamp-2 mt-2 text-sm leading-6 text-slate-300">{detail.analysisSummary || 'ข้อมูลวิเคราะห์ยังจำกัด'}</p>
      </div>
    </Section>
  )
}

function DecisionMetric({ label, value, muted = false }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-2.5">
      <p className="text-[10px] font-black uppercase text-slate-500">{label}</p>
      <p className={`text-clamp-2 mt-1 text-xs font-black leading-5 ${muted ? 'text-slate-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}

function finalDecisionClass(finalPick) {
  if (finalPick.riskLevel === 'HIGH' || finalPick.recommendation === 'NO BET') {
    return 'border-red-300/25 bg-red-400/10'
  }
  if (finalPick.recommendation === 'BET') {
    return 'border-emerald-300/25 bg-emerald-300/10'
  }
  return 'border-amber-300/25 bg-amber-300/10'
}

function AiSelectionBreakdownSection({ detail }) {
  const analysis = detail.analysis ?? {}
  const items = [
    ['League Quality', analysis.league_quality_score],
    ['Match Quality', analysis.match_quality_score],
    ['Team Strength', analysis.team_strength_score],
    ['Form', analysis.form_score],
    ['Goal Scoring', analysis.goal_scoring_score],
    ['Defensive Stability', analysis.defensive_stability_score],
    ['Tactical Matchup', analysis.tactical_matchup_score],
    ['Motivation', analysis.motivation_score],
    ['Market Reading', analysis.market_reading_score],
    ['Home/Away', analysis.home_away_score ?? analysis.home_advantage_score],
    ['Edge Score', analysis.edge_score],
    ['Risk Score', analysis.risk_score],
    ['AI Score', analysis.ai_score],
    ['Confidence', analysis.confidence_score ?? detail.confidence],
    ['Ranking Score', analysis.ranking_score ?? detail.rankingScore],
    ['Final Rank', analysis.final_rank ?? detail.finalRank ?? detail.rank],
  ]

  return (
    <Section title="Selection Engine v2" icon={ListChecks}>
      <div className="grid grid-cols-2 gap-2">
        {items.map(([label, value]) => (
          <Metric key={label} label={label} value={formatSelectionValue(value)} />
        ))}
      </div>
      <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">
        {analysis.final_pick_note || analysis.analysis_summary || detail.analysisSummary || 'Selection Engine กำลังรอข้อมูลวิเคราะห์เพิ่มเติม'}
      </p>
    </Section>
  )
}

function DataIntelligenceV4Section({ detail }) {
  const analysis = detail.analysis ?? {}
  const items = [
    ['Calibrated', analysis.calibrated_confidence_score ?? detail.calibratedConfidence ?? detail.confidence],
    ['Market Edge', analysis.market_edge_score ?? detail.marketEdgeScore],
    ['Odds Conf', analysis.odds_confidence_score ?? detail.oddsConfidenceScore],
    ['Movement', analysis.odds_movement_score ?? detail.oddsMovementScore],
    ['Team Stats', analysis.team_stats_score ?? detail.teamStatsScore],
    ['Injuries', analysis.injuries_score ?? detail.injuriesScore],
    ['Lineups', analysis.lineups_score ?? detail.lineupsScore],
    ['Data Depth', analysis.data_depth_score ?? detail.dataDepthScore],
  ]
  const hasV4 = items.some(([, value]) => value !== null && value !== undefined)
  if (!hasV4 && !analysis.enriched_summary && !analysis.odds_movement_summary) return null

  return (
    <Section title="Data Intelligence v4" icon={TrendingUp}>
      <div className="grid grid-cols-2 gap-2">
        {items.map(([label, value]) => (
          <Metric key={label} label={label} value={formatSelectionValue(value)} />
        ))}
      </div>
      <div className="mt-3 grid gap-2">
        <DecisionMetric label="Value Market" value={analysis.value_market ?? '-'} muted={!analysis.value_market} />
        <DecisionMetric label="Value Side" value={analysis.value_side ?? '-'} muted={!analysis.value_side} />
        <DecisionMetric label="Line" value={analysis.value_line ?? analysis.latest_line ?? '-'} muted={!analysis.value_line && !analysis.latest_line} />
        <DecisionMetric label="Odds Move" value={analysis.odds_movement_summary ?? '-'} muted={!analysis.odds_movement_summary} />
      </div>
      {analysis.enriched_summary ? <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">{analysis.enriched_summary}</p> : null}
    </Section>
  )
}

function FootballEnrichmentSection({ detail }) {
  const data = detail.footballEnrichment

  return (
    <>
      <MatchDataCoverageSection items={data.coverageItems} />
      <MatchStatisticsSection statistics={data.statistics} homeTeam={detail.homeTeam} awayTeam={detail.awayTeam} />
      <TimelineEventsSection events={data.events} />
      <LineupsSection lineups={data.lineups} />
      <PlayerRatingsSection players={data.players} />
      <InjuriesSection injuries={data.injuries} />
      <VenueSection venue={data.venue} fallbackVenue={detail.venue} />
      <LeagueTopPlayersSection topPlayers={data.topPlayers} />
    </>
  )
}

function MatchDataCoverageSection({ items }) {
  return (
    <Section title="Match Data Coverage" icon={ListChecks}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <span className="min-w-0 text-sm font-black text-white">{item.label}</span>
            <span className={`semantic-badge shrink-0 ${coverageTone(item.status)}`}>{item.text}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

function MatchStatisticsSection({ statistics, homeTeam, awayTeam }) {
  const home = findTeamRow(statistics, homeTeam)
  const away = findTeamRow(statistics, awayTeam)
  const rows = [
    ['ยิงตรงกรอบ', 'shots_on_goal'],
    ['ยิงทั้งหมด', 'total_shots'],
    ['ครองบอล', 'ball_possession', '%'],
    ['เตะมุม', 'corner_kicks'],
    ['ฟาวล์', 'fouls'],
    ['ใบเหลือง', 'yellow_cards'],
    ['ใบแดง', 'red_cards'],
    ['เซฟ', 'goalkeeper_saves'],
    ['ผ่านบอลทั้งหมด', 'total_passes'],
    ['ผ่านบอลสำเร็จ', 'passes_accurate'],
  ]

  return (
    <Section title="Match Statistics" icon={Activity}>
      {statistics.length ? (
        <div className="grid gap-2">
          {rows.map(([label, key, suffix]) => (
            <CompareRow key={key} label={label} home={formatStatValue(home?.[key], suffix)} away={formatStatValue(away?.[key], suffix)} />
          ))}
        </div>
      ) : (
        <EmptyThaiState text="ยังไม่มีข้อมูลสถิติเกมนี้" />
      )}
    </Section>
  )
}

function TimelineEventsSection({ events }) {
  return (
    <Section title="Timeline Events" icon={Clock}>
      {events.length ? (
        <div className="grid gap-2">
          {events.map((event) => (
            <div key={`${event.elapsed}-${event.event_type}-${event.player_name}-${event.team_name}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <div className="flex items-start justify-between gap-3">
                <span className="semantic-badge border-blue-300/25 bg-blue-300/10 text-blue-100">{event.elapsed ?? '-'}{event.extra ? `+${event.extra}` : ''}'</span>
                <span className="text-right text-xs font-bold text-slate-400">{event.team_name ?? '-'}</span>
              </div>
              <p className="mt-2 text-sm font-black text-white">{event.event_type ?? 'เหตุการณ์'} · {event.event_detail ?? '-'}</p>
              <p className="mt-1 text-sm leading-6 text-slate-300">{event.player_name ?? 'ไม่ระบุนักเตะ'}{event.assist_player_name ? `, assist: ${event.assist_player_name}` : ''}</p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyThaiState text="ยังไม่มีข้อมูลเหตุการณ์สำคัญของเกมนี้" />
      )}
    </Section>
  )
}

function LineupsSection({ lineups }) {
  return (
    <Section title="Lineups" icon={Users}>
      {lineups.length ? (
        <div className="grid gap-2">
          {lineups.map((lineup) => (
            <div key={lineup.api_team_id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-black text-white">{lineup.team_name ?? 'ทีม'}</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-500">Coach: {lineup.coach_name ?? '-'}</p>
                </div>
                <span className="semantic-badge border-emerald-300/25 bg-emerald-300/10 text-emerald-100">{lineup.formation ?? '-'}</span>
              </div>
              <LineupNames title="Starting XI" players={lineup.start_xi} />
              <LineupNames title="Substitutes" players={lineup.substitutes} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyThaiState text="ยังไม่มีข้อมูลรายชื่อผู้เล่นเกมนี้" />
      )}
    </Section>
  )
}

function PlayerRatingsSection({ players }) {
  const topPlayers = players.slice(0, 12)
  return (
    <Section title="Player Ratings" icon={Star}>
      {topPlayers.length ? (
        <div className="grid gap-2">
          {topPlayers.map((player) => (
            <div key={`${player.api_team_id}-${player.api_player_id}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-black text-white">{player.player_name ?? '-'}</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-500">{player.team_name ?? '-'} · {player.position ?? '-'}</p>
                </div>
                <span className="semantic-badge border-amber-300/25 bg-amber-300/10 text-amber-100">{formatStatValue(player.rating)}</span>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                <MiniStat label="Min" value={player.minutes} />
                <MiniStat label="G/A" value={`${player.goals_total ?? 0}/${player.assists ?? 0}`} />
                <MiniStat label="SOT" value={player.shots_on} />
                <MiniStat label="Pass" value={formatStatValue(player.passes_accuracy, '%')} />
                <MiniStat label="T+I" value={Number(player.tackles_total ?? 0) + Number(player.tackles_interceptions ?? 0)} />
                <MiniStat label="YC" value={player.yellow_cards} />
                <MiniStat label="RC" value={player.red_cards} />
                <MiniStat label="Saves" value={player.saves} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyThaiState text="ยังไม่มีข้อมูลสถิตินักเตะเกมนี้" />
      )}
    </Section>
  )
}

function InjuriesSection({ injuries }) {
  return (
    <Section title="Injuries / Suspensions" icon={ShieldAlert}>
      {injuries.length ? (
        <div className="grid gap-2">
          {injuries.slice(0, 20).map((item) => (
            <div key={`${item.api_fixture_id}-${item.api_player_id}-${item.reason}`} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <p className="font-black text-white">{item.player_name ?? '-'}</p>
              <p className="mt-1 text-sm leading-6 text-slate-300">{item.team_name ?? '-'} · {item.reason ?? 'ไม่ระบุสาเหตุ'}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">{formatDateText(item.fixture_date)}</p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyThaiState text="ยังไม่มีข้อมูลเจ็บ/แบนของเกมนี้" />
      )}
    </Section>
  )
}

function VenueSection({ venue, fallbackVenue }) {
  const display = venue ?? (typeof fallbackVenue === 'object' ? fallbackVenue : fallbackVenue ? { venue_name: fallbackVenue } : null)
  return (
    <Section title="Venue" icon={MapPin}>
      {display ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          {display.image ? <img src={display.image} alt="" className="mb-3 h-36 w-full rounded-2xl object-cover" /> : null}
          <p className="text-lg font-black text-white">{display.venue_name ?? display.name ?? 'สนาม'}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Metric label="เมือง" value={display.city ?? '-'} />
            <Metric label="ประเทศ" value={display.country ?? '-'} />
            <Metric label="ความจุ" value={display.capacity ? Number(display.capacity).toLocaleString() : '-'} />
            <Metric label="พื้นสนาม" value={display.surface ?? '-'} />
          </div>
        </div>
      ) : (
        <EmptyThaiState text="ยังไม่มีข้อมูลสนามของเกมนี้" />
      )}
    </Section>
  )
}

function LeagueTopPlayersSection({ topPlayers }) {
  const tabs = [
    ['top_scorers', 'ดาวซัลโว', 'goals_total'],
    ['top_assists', 'แอสซิสต์', 'assists'],
    ['top_yellow_cards', 'ใบเหลือง', 'yellow_cards'],
    ['top_red_cards', 'ใบแดง', 'red_cards'],
  ]
  const [active, setActive] = useState('top_scorers')
  const activeTab = tabs.find(([key]) => key === active) ?? tabs[0]
  const rows = topPlayers?.[active] ?? []

  return (
    <Section title="League Top Players" icon={TrendingUp}>
      <div className="grid grid-cols-4 gap-1.5">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setActive(key)} className={`rounded-xl border px-2 py-2 text-xs font-black ${active === key ? 'border-blue-300/35 bg-blue-300/15 text-blue-50' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>
            {label}
          </button>
        ))}
      </div>
      {rows.length ? (
        <div className="mt-3 grid gap-2">
          {rows.slice(0, 10).map((player) => (
            <div key={`${active}-${player.api_player_id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <div className="min-w-0">
                <p className="truncate font-black text-white">#{player.rank ?? '-'} {player.player_name ?? '-'}</p>
                <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{player.team_name ?? '-'}</p>
              </div>
              <span className="semantic-badge border-cyan-300/25 bg-cyan-300/10 text-cyan-100">{formatStatValue(player[activeTab[2]])}</span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyThaiState text="ยังไม่มีข้อมูลผู้นำสถิติของลีกนี้" />
      )}
    </Section>
  )
}

function formatSelectionValue(value) {
  if (value === null || value === undefined || value === '') return '-'
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${Math.round(numeric * 10) / 10}` : String(value)
}

function ScoreBreakdownSection({ items }) {
  return (
    <Section title="Module Breakdown" icon={Gauge}>
      <div className="space-y-2.5">
        {items.map((item) => (
          <ScoreRow key={item.key} item={item} />
        ))}
      </div>
    </Section>
  )
}

function ExplainableAiSection({ explanation }) {
  return (
    <Section title="Explainable AI" icon={Brain}>
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Base" value={`${explanation.baseConfidence}%`} />
        <Metric label="Final" value={`${explanation.finalConfidence}%`} />
        <Metric label="Risk Impact" value={formatContribution(explanation.riskImpact?.value)} />
        <Metric label="Data Impact" value={formatContribution(explanation.dataConfidenceImpact?.value)} />
      </div>
      <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">{explanation.summary}</p>
      <ContributionList title="Positive Factors" items={explanation.positive} tone="positive" />
      <ContributionList title="Negative Factors" items={explanation.negative} tone="negative" />
      <ContributionList title="Neutral Factors" items={explanation.neutral} />
    </Section>
  )
}

function FootballIntelligenceSection({ intelligence }) {
  const cards = [
    { title: 'H2H', score: intelligence.h2h?.score, meta: `confidence ${intelligence.h2h?.confidence ?? 'low'}`, reason: intelligence.h2h?.reason, signals: intelligence.h2h?.signals },
    { title: 'League Context', score: intelligence.league_context?.score, meta: `${intelligence.league_context?.type ?? 'unknown'} · risk ${formatSigned(intelligence.league_context?.risk_modifier)}`, reason: intelligence.league_context?.reason },
    { title: 'Rest Days', score: intelligence.rest_days?.score, meta: `${formatDays(intelligence.rest_days?.home_rest_days)} vs ${formatDays(intelligence.rest_days?.away_rest_days)}`, reason: intelligence.rest_days?.reason },
    { title: 'Schedule Difficulty', score: intelligence.schedule_difficulty?.score, meta: `${intelligence.schedule_difficulty?.difficulty ?? 'unknown'} · ${intelligence.schedule_difficulty?.confidence ?? 'low'}`, reason: intelligence.schedule_difficulty?.reason },
    { title: 'Squad Context', score: intelligence.squad_context?.score, meta: `confidence ${intelligence.squad_context?.confidence ?? 'low'}`, reason: intelligence.squad_context?.reason, signals: intelligence.squad_context?.signals },
    { title: 'Momentum', score: intelligence.momentum?.score, meta: intelligence.momentum?.momentum ?? 'unknown', reason: intelligence.momentum?.reason, signals: intelligence.momentum?.signals },
    { title: 'Match Importance', score: intelligence.match_importance?.score, meta: `${intelligence.match_importance?.importance ?? 'unknown'} · risk ${formatSigned(intelligence.match_importance?.risk_modifier)}`, reason: intelligence.match_importance?.reason },
  ]

  return (
    <Section title="Strength / Weakness" icon={TrendingUp}>
      <div className="grid gap-2.5">
        {cards.map((card) => (
          <IntelligenceCard key={card.title} card={card} />
        ))}
      </div>
    </Section>
  )
}

function FootballDataIntelligenceSection({ items }) {
  return (
    <Section title="Data Intelligence" icon={ListChecks}>
      <div className="grid gap-2.5">
        {(items ?? []).map((item) => (
          <DataIntelligenceCard key={item.key} item={item} />
        ))}
      </div>
    </Section>
  )
}

function ContextSection({ title, icon, body }) {
  const Icon = icon
  return (
    <Section title={title} icon={Icon}>
      <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">{body}</p>
    </Section>
  )
}

function PredictionReliabilitySection({ reliability }) {
  const data = reliability ?? {}
  return (
    <Section title="Prediction Reliability" icon={Gauge}>
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Calibration" value={`${Math.round(data.confidenceCalibration ?? 0)}%`} />
        <Metric label="Historical" value={`${Math.round(data.historicalAccuracy ?? 0)}%`} />
        <Metric label="League" value={`${Math.round(data.leagueAccuracy ?? 0)}%`} />
        <Metric label="Data" value={`${Math.round(data.dataConfidence ?? 0)}%`} />
      </div>
      <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">{data.label || 'Collecting evaluation history'}</p>
    </Section>
  )
}

function RiskAnalysisSection({ detail, riskLabel, riskFactors }) {
  return (
    <Section title="Risk Control" icon={ShieldAlert}>
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-3">
        <p className="text-sm font-bold text-slate-400">Risk Level</p>
        <div className="flex items-center gap-2">
          <RiskBadge level={detail.riskLevel} />
          <span className="text-sm font-black text-white">{riskLabel.label}</span>
        </div>
      </div>
      <BulletList title="Risk factors" items={riskFactors} tone={String(detail.riskLevel).toLowerCase() === 'high' ? 'danger' : 'warning'} />
    </Section>
  )
}

function RankingSection({ detail }) {
  return (
    <Section title="Ranking Explanation" icon={Star}>
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Rank" value={detail.rank ? `#${detail.rank}` : '-'} />
        <Metric label="Ranking" value={`${detail.rankingScore}/100`} />
        <Metric label="Data Quality" value={`${detail.dataQuality.score}%`} />
        <Metric label="Badges" value={`${detail.rankBadges.length}`} />
      </div>
      <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">{detail.rankReason}</p>
      {detail.rankBadges.length ? <ChipList items={detail.rankBadges} /> : null}
    </Section>
  )
}

function DataQualitySection({ dataQuality }) {
  return (
    <Section title="Data Quality" icon={ListChecks}>
      <ProgressPanel label="Completeness" value={dataQuality.score} tone={dataQuality.score >= 70 ? 'good' : dataQuality.score >= 45 ? 'medium' : 'risk'} />
      <QualityList title="Available" items={dataQuality.available} />
      <QualityList title="Missing" items={dataQuality.missing} muted />
    </Section>
  )
}

function DataPlatformCoverageSection({ coverage }) {
  return (
    <Section title="Data Coverage" icon={ListChecks}>
      <ProgressPanel label={`Coverage · ${coverage.level}`} value={coverage.score} tone={coverage.score >= 75 ? 'good' : coverage.score >= 45 ? 'medium' : 'risk'} />
      <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">{coverage.reason}</p>
      <QualityList title="Available" items={coverage.available} />
      <QualityList title="Missing" items={coverage.missing} muted />
    </Section>
  )
}

function MarketIntelligenceSection({ market }) {
  return (
    <Section title="Market Intelligence" icon={TrendingUp}>
      <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">{market.reason}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Asian" value={formatMarketValue(market.asian_handicap)} />
        <Metric label="O/U" value={formatMarketValue(market.over_under)} />
        <Metric label="1X2" value={formatMarketValue(market.one_x_two)} />
        <Metric label="Value" value={formatMarketValue(market.value_rating)} />
      </div>
    </Section>
  )
}

function SummarySection({ detail }) {
  const paragraphs = [
    ...splitSummary(detail.analysisSummary),
    detail.footballIntelligence?.ai_explanation?.summary,
  ].filter(Boolean)

  return (
    <Section title="Full AI Summary" icon={Brain}>
      <div className="space-y-3">
        {paragraphs.map((paragraph, index) => (
          <p key={`${paragraph}-${index}`} className="text-sm leading-6 text-slate-300">{paragraph}</p>
        ))}
      </div>
    </Section>
  )
}

function Section({ title, icon: Icon, children, accent = false }) {
  return (
    <section className={`mt-3.5 rounded-[20px] border p-3.5 ${accent ? 'border-blue-300/25 bg-blue-300/10 shadow-[0_16px_42px_rgba(0,0,0,0.22)]' : 'border-white/10 bg-white/[0.035]'}`}>
      <h3 className="section-title flex items-center gap-2">
        <Icon size={18} className="text-[var(--page-accent)]" />
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function ScoreRow({ item }) {
  const subtitle = moduleSubtitles[item.label] ?? ''
  return (
    <div className="compact-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-black leading-5 text-white">{item.label}</p>
          {subtitle ? <p className="text-xs font-semibold text-slate-500">{subtitle}</p> : null}
        </div>
        <span className={`semantic-badge shrink-0 ${toneClass(item.tone)}`}>{Math.round(item.score ?? 0)}/100</span>
      </div>
      <ProgressBar value={item.score} tone={item.tone} />
      <p className="text-clamp-1 mt-2 text-xs leading-5 text-slate-400">{item.reason || 'Limited data'}</p>
    </div>
  )
}

function IntelligenceCard({ card }) {
  return (
    <div className="feature-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-black text-white">{card.title}</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">{card.meta || 'Limited data'}</p>
        </div>
        <span className="semantic-badge border-white/10 bg-white/[0.05] text-white">{Math.round(card.score ?? 0)}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-300">{card.reason || 'Limited data'}</p>
      {card.signals?.length ? <ChipList items={card.signals.slice(0, 4)} /> : null}
    </div>
  )
}

function DataIntelligenceCard({ item }) {
  return (
    <div className="feature-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-black text-white">{item.label}</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">confidence {item.confidence ?? 'low'}</p>
        </div>
        <span className={`semantic-badge shrink-0 ${toneClass(item.tone)}`}>{Math.round(item.score ?? 0)}/100</span>
      </div>
      <ProgressBar value={item.score} tone={item.tone} />
      <p className="mt-2 text-sm leading-6 text-slate-300">{item.reason || 'Limited data'}</p>
      {item.key === 'data_confidence' ? (
        <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <QualityInline title="Available" items={item.available} />
          <QualityInline title="Missing" items={item.missing} muted />
        </div>
      ) : null}
    </div>
  )
}

function TeamBlock({ team, align }) {
  const right = align === 'right'
  return (
    <div className={`min-w-0 ${right ? 'text-right' : ''}`}>
      <div className={`flex min-w-0 items-center gap-2 ${right ? 'flex-row-reverse' : ''}`}>
        {team?.logo ? <img src={team.logo} alt="" className="h-10 w-10 shrink-0 rounded-full bg-white/10 object-contain p-1" /> : <div className="h-10 w-10 shrink-0 rounded-full bg-white/10" />}
        <h2 className="truncate text-lg font-black leading-6 text-white">{team?.name ?? 'Unknown team'}</h2>
      </div>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="metric-display">
      <p className="text-[10px] font-black uppercase text-slate-500">{label}</p>
      <div className="mt-1 break-words text-base font-black leading-5 text-white">{value || '-'}</div>
    </div>
  )
}

function ProgressPanel({ label, value, tone }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-bold text-slate-400">{label}</span>
        <span className="font-black text-white">{value}%</span>
      </div>
      <ProgressBar value={value} tone={tone} />
    </div>
  )
}

function ProgressBar({ value, tone }) {
  return (
    <div className="progress-bar mt-3">
      <span className={barTone(tone)} style={{ width: `${Math.max(4, Math.min(100, value ?? 0))}%` }} />
    </div>
  )
}

function StatePanel({ title, message, tone = 'default', children, icon: Icon = Sparkles }) {
  return (
    <div className={`empty-state ${tone === 'error' ? 'border-red-400/30 bg-red-400/10' : ''}`}>
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(var(--page-accent-rgb),0.25)] bg-[rgba(var(--page-accent-rgb),0.1)] text-[var(--page-accent)]">
        <Icon size={28} />
      </div>
      <p className="mt-4 text-lg font-black text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-300">{message}</p>
      {children}
    </div>
  )
}

function TwoColumnLists({ leftTitle, leftItems, rightTitle, rightItems }) {
  return (
    <div className="mt-3 grid gap-2">
      <BulletList title={leftTitle} items={leftItems} tone="positive" />
      <BulletList title={rightTitle} items={rightItems} tone="warning" />
    </div>
  )
}

function BulletList({ title, items, tone = 'default' }) {
  const safeItems = items?.length ? items : ['Limited data']
  return (
    <div>
      <p className="text-sm font-black text-white">{title}</p>
      <div className="mt-2 grid gap-1.5">
        {safeItems.map((item) => (
          <p key={item} className={`rounded-xl border px-3 py-2 text-sm leading-6 ${bulletTone(tone)}`}>{item}</p>
        ))}
      </div>
    </div>
  )
}

function ContributionList({ title, items, tone = 'neutral' }) {
  const safeItems = items?.length ? items : [{ key: `${title}-empty`, label: 'Limited data', value: 0, reason: 'Collecting data' }]
  return (
    <div className="mt-3">
      <p className="text-sm font-black text-white">{title}</p>
      <div className="mt-2 grid gap-1.5">
        {safeItems.map((item) => (
          <div key={item.key} className={`rounded-xl border px-3 py-2 text-sm leading-6 ${contributionTone(tone === 'neutral' ? item.type : tone)}`}>
            <div className="flex items-start justify-between gap-3">
              <span className="font-black">{item.label}</span>
              <span className="shrink-0 font-black">{formatContribution(item.value)}</span>
            </div>
            <p className="mt-1 text-xs leading-5 opacity-90">{item.reason}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function QualityList({ title, items, muted = false }) {
  return (
    <div className="mt-3">
      <p className="text-sm font-black text-white">{title}</p>
      <ChipList items={items?.length ? items : ['None']} muted={muted} />
    </div>
  )
}

function QualityInline({ title, items = [], muted = false }) {
  const safeItems = items.length ? items : ['Limited data']
  return (
    <div className={`rounded-xl border p-2 ${muted ? 'border-slate-500/20 bg-slate-500/10' : 'border-cyan-300/20 bg-cyan-300/10'}`}>
      <p className="font-black text-white">{title}</p>
      <p className="mt-1 leading-5 text-slate-300">{safeItems.slice(0, 4).join(', ')}</p>
    </div>
  )
}

function ChipList({ items, muted = false }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className={`semantic-badge ${muted ? 'border-slate-500/20 bg-slate-500/10 text-slate-300' : 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100'}`}>{item}</span>
      ))}
    </div>
  )
}

function CompareRow({ label, home, away }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)_72px] items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <span className="text-left text-sm font-black text-white">{home}</span>
      <span className="text-center text-xs font-bold leading-5 text-slate-400">{label}</span>
      <span className="text-right text-sm font-black text-white">{away}</span>
    </div>
  )
}

function EmptyThaiState({ text }) {
  return <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-300">{text}</p>
}

function LineupNames({ title, players }) {
  const names = (players ?? [])
    .map((item) => item.player?.name ?? item.name ?? item.player_name)
    .filter(Boolean)
    .slice(0, 14)
  return (
    <div className="mt-3">
      <p className="text-xs font-black uppercase text-slate-500">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-300">{names.length ? names.join(', ') : 'ยังไม่มีข้อมูล'}</p>
    </div>
  )
}

function MiniStat({ label, value }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-white/[0.04] p-2 text-center">
      <p className="text-[10px] font-black uppercase text-slate-500">{label}</p>
      <p className="mt-1 truncate text-xs font-black text-white">{value ?? '-'}</p>
    </div>
  )
}

function findTeamRow(statistics, team) {
  const teamId = Number(team?.api_team_id)
  return statistics.find((row) => Number(row.api_team_id) === teamId) ?? statistics.find((row) => row.team_name === team?.name) ?? null
}

function formatStatValue(value, suffix = '') {
  if (value === null || value === undefined || value === '') return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  const rounded = Math.round(numeric * 10) / 10
  return `${rounded}${suffix}`
}

function formatDateText(value) {
  if (!value) return 'ยังไม่ระบุวันที่'
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function coverageTone(status) {
  if (status === 'ready') return 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
  if (status === 'unsupported') return 'border-slate-500/25 bg-slate-500/10 text-slate-300'
  return 'border-amber-300/25 bg-amber-300/10 text-amber-100'
}

function getVenueText(detail) {
  const venue = detail.venue ?? detail.raw?.venue ?? detail.raw?.fixture?.venue?.name ?? ''
  if (!venue) return ''
  if (typeof venue === 'string') return venue.trim()
  return [venue.name, venue.city].filter(Boolean).join(', ')
}

function toneClass(tone) {
  if (tone === 'good') return 'badge-positive'
  if (tone === 'risk') return 'badge-high'
  return 'badge-medium'
}

function barTone(tone) {
  if (tone === 'good') return 'bg-gradient-to-r from-emerald-400 to-cyan-200'
  if (tone === 'risk') return 'bg-gradient-to-r from-red-400 to-rose-200'
  return 'bg-gradient-to-r from-amber-300 to-blue-300'
}

function bulletTone(tone) {
  if (tone === 'danger') return 'border-red-400/25 bg-red-400/10 text-red-100'
  if (tone === 'warning') return 'border-amber-300/25 bg-amber-300/10 text-amber-100'
  if (tone === 'positive') return 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
  return 'border-white/10 bg-white/[0.04] text-slate-200'
}

function contributionTone(tone) {
  if (tone === 'positive') return 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100'
  if (tone === 'negative') return 'border-red-400/25 bg-red-400/10 text-red-100'
  return 'border-white/10 bg-white/[0.04] text-slate-200'
}

function formatDays(value) {
  return value === null || value === undefined ? 'unknown' : `${value} days`
}

function formatSigned(value) {
  const numeric = Number(value ?? 0)
  return `${numeric >= 0 ? '+' : ''}${numeric}`
}

function formatContribution(value) {
  const numeric = Number(value ?? 0)
  return `${numeric >= 0 ? '+' : ''}${Math.round(numeric * 10) / 10}`
}

function formatMarketValue(value) {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'object') return 'พร้อมใช้งาน'
  return String(value)
}
