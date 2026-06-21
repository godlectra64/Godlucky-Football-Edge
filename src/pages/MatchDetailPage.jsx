import { ArrowLeft, Clock3, MapPin, ShieldAlert } from 'lucide-react'
import ModuleScoreList from '../components/ModuleScoreList'
import RiskBadge from '../components/RiskBadge'
import ScoreBadge from '../components/ScoreBadge'
import { getAnalysisSummary, getConfidence, getRecommendation, getRiskLevel } from '../utils/analysisEngine'
import { formatKickoffTime, formatScore, formatUpdatedAt } from '../utils/formatters'

export default function MatchDetailPage({ match, onBack, onGoToday }) {
  if (!match) {
    return (
      <main className="mx-auto max-w-[430px] px-4 py-6">
        <div className="rounded-lg border border-white/10 bg-pitch-800 p-6 text-center">
          <p className="text-lg font-bold text-white">ยังไม่ได้เลือกคู่สำหรับวิเคราะห์</p>
          <button type="button" onClick={onGoToday} className="mt-4 min-h-12 rounded-lg bg-emerald-400 px-5 font-bold text-pitch-950">
            ไปหน้า วันนี้
          </button>
        </div>
      </main>
    )
  }

  const recommendation = getRecommendation(match)
  const confidence = getConfidence(match)
  const riskLevel = getRiskLevel(match)

  return (
    <main className="mx-auto max-w-[430px] px-4 py-4">
      <button type="button" onClick={onBack} className="mb-3 flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold text-slate-300">
        <ArrowLeft size={20} />
        กลับ
      </button>

      <section className="rounded-lg border border-white/10 bg-pitch-800 p-4 shadow-glow">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <Clock3 size={16} />
              {match.league?.name ?? 'ไม่ระบุลีก'} · {formatKickoffTime(match.kickoffAt)}
            </p>
            <TeamName team={match.homeTeam} />
            <p className="my-2 text-sm font-semibold text-slate-400">พบกับ</p>
            <TeamName team={match.awayTeam} />
          </div>
          <ScoreBadge recommendation={recommendation} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Metric label="ความมั่นใจ" value={`${confidence}%`} />
          <Metric label="ความเสี่ยง" value={<RiskBadge level={riskLevel} />} />
          <Metric label="ผลล่าสุด" value={formatScore(match.homeGoals, match.awayGoals)} />
          <Metric label="อัปเดต" value={formatUpdatedAt(match.updatedAt)} />
        </div>

        <p className="mt-4 flex items-center gap-2 text-sm text-slate-400">
          <MapPin size={16} />
          {match.venue || 'ยังไม่มีข้อมูลสนาม'}
        </p>
      </section>

      <section className="mt-4 rounded-lg border border-white/10 bg-pitch-800 p-4">
        <h3 className="text-lg font-bold text-white">คะแนนแต่ละโมดูล</h3>
        <div className="mt-4">
          <ModuleScoreList match={match} />
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-white/10 bg-pitch-800 p-4">
        <h3 className="text-lg font-bold text-white">ฟอร์ม 5 นัดหลัง</h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <FormBox label={match.homeTeam?.name ?? 'ทีมเหย้า'} form={match.homeForm} />
          <FormBox label={match.awayTeam?.name ?? 'ทีมเยือน'} form={match.awayForm} />
        </div>
      </section>

      <StandingsBox match={match} />

      <section className="mt-4 rounded-lg border border-white/10 bg-pitch-800 p-4">
        <h3 className="text-lg font-bold text-white">เหตุผลภาษาไทย</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          {getAnalysisSummary(match)}
        </p>
      </section>

      <section className="mt-4 rounded-lg border border-amber-300/25 bg-amber-300/10 p-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-amber-100">
          <ShieldAlert size={20} />
          ข้อควรระวัง
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-200">
          ตรวจรายชื่อผู้เล่น สภาพอากาศ และการเปลี่ยนแปลงราคาก่อนแข่งทุกครั้ง โดยเฉพาะคู่ที่มี risk_level เป็น high
        </p>
      </section>
    </main>
  )
}

function TeamName({ team }) {
  return (
    <div className="mt-2 flex min-w-0 items-center gap-3">
      {team?.logo ? <img src={team.logo} alt="" className="h-10 w-10 rounded-full bg-white/10 object-contain p-1" /> : <div className="h-10 w-10 rounded-full bg-white/10" />}
      <h2 className="truncate text-xl font-black text-white">{team?.name ?? 'ไม่ระบุทีม'}</h2>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-pitch-900 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <div className="mt-1 text-sm font-bold text-white">{value || '-'}</div>
    </div>
  )
}

function FormBox({ label, form }) {
  return (
    <div className="rounded-lg bg-white/[0.05] p-3">
      <p className="truncate text-xs text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-black text-white">
        {form ? `${form.wins ?? 0}-${form.draws ?? 0}-${form.losses ?? 0}` : '-'}
      </p>
      <p className="mt-1 text-xs text-slate-400">
        ยิง {form?.goals_for ?? 0} / เสีย {form?.goals_against ?? 0}
      </p>
    </div>
  )
}

function StandingsBox({ match }) {
  const rows = getRelevantStandings(match)

  return (
    <section className="mt-4 rounded-lg border border-white/10 bg-pitch-800 p-4">
      <h3 className="text-lg font-bold text-white">ตารางคะแนน</h3>
      {rows.length ? (
        <div className="mt-3 space-y-2">
          {rows.map((row) => (
            <div key={row.teamId} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-lg bg-white/[0.05] p-3 text-sm">
              <p className="min-w-0 truncate font-bold text-white">{row.name}</p>
              <p className="text-slate-300">#{row.position}</p>
              <p className="text-slate-300">{row.points} แต้ม</p>
              <p className="text-slate-300">GD {row.goalDifference}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm leading-6 text-slate-300">ยังไม่มีข้อมูลตารางคะแนนจาก provider สำหรับคู่นี้</p>
      )}
    </section>
  )
}

function getRelevantStandings(match) {
  const table = (match.standings ?? match.analysis?.raw?.standings ?? [])
    .find((standing) => standing.type === 'TOTAL')?.table ?? []
  const teamIds = new Set([match.homeTeam?.api_team_id, match.awayTeam?.api_team_id].filter(Boolean).map(Number))

  return table
    .filter((row) => teamIds.has(Number(row.team?.id)))
    .map((row) => ({
      teamId: row.team?.id,
      name: row.team?.name ?? 'ไม่ระบุทีม',
      position: row.position ?? '-',
      points: row.points ?? 0,
      goalDifference: row.goalDifference ?? 0,
    }))
}
