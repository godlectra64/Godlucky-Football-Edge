import { ArrowLeft, Bookmark, CheckCircle2, Clock3, ShieldAlert } from 'lucide-react'
import ModuleScoreList from '../components/ModuleScoreList'
import RiskBadge from '../components/RiskBadge'
import ScoreBadge from '../components/ScoreBadge'
import { calculateAnalysisScore, calculateSelectionScore, getConfidence, getRecommendation } from '../utils/analysisEngine'

const statuses = ['เล่นได้', 'รอดูราคา', 'ข้าม']

export default function MatchDetailPage({ match, onBack, onUpdateMatch, onGoToday }) {
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
  const analysisScore = calculateAnalysisScore(match)
  const selectionScore = calculateSelectionScore(match)
  const confidence = getConfidence(match)

  const setUserStatus = (userStatus) => onUpdateMatch({ ...match, userStatus })
  const saveInterest = () => onUpdateMatch({ ...match, userStatus: match.userStatus === 'สนใจ' ? '' : 'สนใจ' })

  return (
    <main className="mx-auto max-w-[430px] px-4 py-4">
      <button type="button" onClick={onBack} className="mb-3 flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold text-slate-300">
        <ArrowLeft size={20} />
        กลับ
      </button>

      <section className="rounded-lg border border-white/10 bg-pitch-800 p-4 shadow-glow">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <Clock3 size={16} />
              {match.league} · {match.time}
            </p>
            <h2 className="mt-2 text-2xl font-black leading-tight text-white">{match.homeTeam}</h2>
            <p className="font-semibold text-slate-400">vs {match.awayTeam}</p>
          </div>
          <ScoreBadge recommendation={recommendation} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Metric label="ตลาดแนะนำ" value={match.recommendedMarket} />
          <Metric label="มั่นใจ" value={`${confidence}%`} />
          <Metric label="AH Line" value={match.ahLine} />
          <Metric label="OU Line" value={match.ouLine} />
          <Metric label="Fair Line" value={match.fairLine} />
          <Metric label="Edge" value={match.edge} />
          <Metric label="คะแนนรวม" value={`${analysisScore}/100`} />
          <Metric label="คะแนนคัดเลือก" value={`${selectionScore}/100`} />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <RiskBadge level={match.riskLevel} />
          <span className="text-sm text-slate-400">ผลล่าสุด: {match.result}</span>
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-white/10 bg-pitch-800 p-4">
        <h3 className="text-lg font-bold text-white">คะแนน 8 โมดูล</h3>
        <div className="mt-4">
          <ModuleScoreList modules={match.modules} />
        </div>
      </section>

      <ReasonBlock title="เหตุผลที่ควรเล่น" items={match.supportReasons} tone="good" />
      <ReasonBlock title="เหตุผลที่ควรระวัง" items={match.cautionReasons} tone="warn" />

      <section className="mt-4 rounded-lg border border-white/10 bg-pitch-800 p-4">
        <h3 className="text-lg font-bold text-white">Market Movement</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">{match.marketMovement || '-'}</p>
        <div className="mt-4 rounded-lg bg-white/[0.05] p-3">
          <p className="text-xs font-semibold text-emerald-200">สรุปสุดท้าย</p>
          <p className="mt-1 text-sm leading-6 text-white">{match.summary || '-'}</p>
        </div>
      </section>

      <div className="mt-4 grid gap-2">
        <button
          type="button"
          onClick={saveInterest}
          className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-emerald-300/40 bg-emerald-400/10 font-bold text-emerald-100"
        >
          <Bookmark size={19} />
          {match.userStatus === 'สนใจ' ? 'ยกเลิกคู่สนใจ' : 'บันทึกเป็นคู่สนใจ'}
        </button>
        <div className="grid grid-cols-3 gap-2">
          {statuses.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setUserStatus(status)}
              className={`min-h-12 rounded-lg border px-2 text-sm font-bold ${
                match.userStatus === status
                  ? 'border-emerald-300 bg-emerald-400 text-pitch-950'
                  : 'border-white/10 bg-pitch-900 text-slate-300'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-pitch-900 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-bold text-white">{value || '-'}</p>
    </div>
  )
}

function ReasonBlock({ title, items = [], tone }) {
  const Icon = tone === 'good' ? CheckCircle2 : ShieldAlert
  const color = tone === 'good' ? 'text-emerald-200' : 'text-amber-100'

  return (
    <section className="mt-4 rounded-lg border border-white/10 bg-pitch-800 p-4">
      <h3 className={`flex items-center gap-2 text-lg font-bold ${color}`}>
        <Icon size={20} />
        {title}
      </h3>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
        {items.filter(Boolean).map((item) => (
          <li key={item} className="rounded-lg bg-white/[0.04] p-3">
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}
