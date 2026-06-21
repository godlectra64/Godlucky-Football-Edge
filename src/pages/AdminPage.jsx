import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { analysisModuleLabels, selectionFactorLabels } from '../data/demoMatches'
import { clampScore } from '../utils/formatters'
import { createEmptyMatch } from '../utils/storage'

const markets = ['AH', 'OU', '1X2', 'BTTS', 'NO BET']
const risks = ['ต่ำ', 'กลาง', 'สูง']
const results = ['Pending', 'Win', 'Lose', 'Push']
const selectionMax = {
  dataQualityScore: 15,
  leagueTrustScore: 10,
  oddsClarityScore: 15,
  formQualityScore: 15,
  goalChanceScore: 15,
  motivationScore: 10,
  marketMovementScore: 10,
  riskControlScore: 10,
}

export default function AdminPage({ matches, onSaveMatch, onDeleteMatch, onResetDemo }) {
  const [form, setForm] = useState(createEmptyMatch)
  const isEditing = matches.some((match) => match.id === form.id)

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const updateModule = (key, value) => {
    setForm((current) => ({
      ...current,
      modules: { ...current.modules, [key]: clampScore(value, 10) },
    }))
  }
  const updateSelection = (key, value) => {
    setForm((current) => ({
      ...current,
      selection: { ...current.selection, [key]: clampScore(value, selectionMax[key]) },
    }))
  }

  const submit = (event) => {
    event.preventDefault()
    onSaveMatch({
      ...form,
      supportReasons: (form.supportReasons ?? []).filter(Boolean),
      cautionReasons: (form.cautionReasons ?? []).filter(Boolean),
    })
    setForm(createEmptyMatch())
  }

  const editMatch = (match) => {
    const empty = createEmptyMatch()
    setForm({
      ...empty,
      ...match,
      modules: { ...empty.modules, ...match.modules },
      selection: { ...empty.selection, ...match.selection },
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <main className="mx-auto max-w-[430px] px-4 py-4">
      <section className="rounded-lg border border-white/10 bg-pitch-800 p-4">
        <h2 className="text-2xl font-black text-white">แอดมินคู่บอล</h2>
        <p className="mt-1 text-sm text-slate-400">เพิ่ม แก้ไข ลบ และรีเซ็ตข้อมูล demo ใน LocalStorage</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setForm(createEmptyMatch())}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-emerald-400 font-bold text-pitch-950"
          >
            <Plus size={18} />
            คู่ใหม่
          </button>
          <button
            type="button"
            onClick={onResetDemo}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-amber-300/40 bg-amber-300/10 font-bold text-amber-100"
          >
            <RotateCcw size={18} />
            Demo 12 คู่
          </button>
        </div>
      </section>

      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormBlock title={isEditing ? 'แก้ไขคู่บอล' : 'เพิ่มคู่บอล'}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="วันที่แข่ง" type="date" value={form.date} onChange={(value) => update('date', value)} />
            <Field label="เวลาแข่ง" type="time" value={form.time} onChange={(value) => update('time', value)} />
          </div>
          <Field label="ลีก" value={form.league} onChange={(value) => update('league', value)} />
          <Field label="ทีมเหย้า" value={form.homeTeam} onChange={(value) => update('homeTeam', value)} />
          <Field label="ทีมเยือน" value={form.awayTeam} onChange={(value) => update('awayTeam', value)} />
        </FormBlock>

        <FormBlock title="ราคาและตลาด">
          <Field label="AH Line" value={form.ahLine} onChange={(value) => update('ahLine', value)} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="AH Odds Home" value={form.ahOddsHome} onChange={(value) => update('ahOddsHome', value)} />
            <Field label="AH Odds Away" value={form.ahOddsAway} onChange={(value) => update('ahOddsAway', value)} />
          </div>
          <Field label="OU Line" value={form.ouLine} onChange={(value) => update('ouLine', value)} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Over Odds" value={form.overOdds} onChange={(value) => update('overOdds', value)} />
            <Field label="Under Odds" value={form.underOdds} onChange={(value) => update('underOdds', value)} />
          </div>
          <SelectField label="Recommended Market" value={form.recommendedMarket} options={markets} onChange={(value) => update('recommendedMarket', value)} />
          <Field label="Fair Line" value={form.fairLine} onChange={(value) => update('fairLine', value)} />
          <Field label="Edge" value={form.edge} onChange={(value) => update('edge', value)} />
          <SelectField label="Risk Level" value={form.riskLevel} options={risks} onChange={(value) => update('riskLevel', value)} />
          <SelectField label="Result" value={form.result} options={results} onChange={(value) => update('result', value)} />
        </FormBlock>

        <FormBlock title="เหตุผลและสรุป">
          <TextArea label="Market Movement Note" value={form.marketMovement} onChange={(value) => update('marketMovement', value)} />
          <TextArea
            label="เหตุผลสนับสนุน"
            value={(form.supportReasons ?? []).join('\n')}
            onChange={(value) => update('supportReasons', value.split('\n'))}
          />
          <TextArea
            label="เหตุผลควรระวัง"
            value={(form.cautionReasons ?? []).join('\n')}
            onChange={(value) => update('cautionReasons', value.split('\n'))}
          />
          <TextArea label="สรุปสุดท้าย" value={form.summary} onChange={(value) => update('summary', value)} />
        </FormBlock>

        <FormBlock title="คะแนนวิเคราะห์ 8 โมดูล">
          <div className="grid gap-3">
            {Object.entries(analysisModuleLabels).map(([key, label]) => (
              <NumberField key={key} label={label} value={form.modules[key]} max={10} onChange={(value) => updateModule(key, value)} />
            ))}
          </div>
        </FormBlock>

        <FormBlock title="คะแนนคัดเลือก Top 10">
          <div className="grid gap-3">
            {Object.entries(selectionFactorLabels).map(([key, label]) => (
              <NumberField key={key} label={`${label} /${selectionMax[key]}`} value={form.selection[key]} max={selectionMax[key]} onChange={(value) => updateSelection(key, value)} />
            ))}
          </div>
        </FormBlock>

        <button type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 text-base font-black text-pitch-950">
          <Save size={19} />
          {isEditing ? 'บันทึกการแก้ไข' : 'เพิ่มคู่บอล'}
        </button>
      </form>

      <section className="mt-5 space-y-3">
        <h3 className="text-lg font-bold text-white">รายการทั้งหมด</h3>
        {matches.map((match) => (
          <article key={match.id} className="rounded-lg border border-white/10 bg-pitch-800 p-4">
            <p className="text-xs text-slate-400">{match.date} · {match.time} · {match.league}</p>
            <h4 className="mt-1 font-bold text-white">{match.homeTeam} vs {match.awayTeam}</h4>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => editMatch(match)} className="min-h-11 rounded-lg bg-white/10 font-bold text-white">
                แก้ไข
              </button>
              <button
                type="button"
                onClick={() => onDeleteMatch(match.id)}
                className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-red-400/40 bg-red-400/10 font-bold text-red-100"
              >
                <Trash2 size={17} />
                ลบ
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  )
}

function FormBlock({ title, children }) {
  return (
    <section className="space-y-3 rounded-lg border border-white/10 bg-pitch-800 p-4">
      <h3 className="text-lg font-bold text-white">{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-12 w-full rounded-lg border border-white/10 bg-pitch-900 px-3 text-base text-white outline-none focus:border-emerald-300"
      />
    </label>
  )
}

function NumberField({ label, value, onChange, max }) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <input
        type="range"
        min="0"
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-8 w-full accent-emerald-400"
      />
    </label>
  )
}

function SelectField({ label, value, options, onChange }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-12 w-full rounded-lg border border-white/10 bg-pitch-900 px-3 text-base text-white outline-none focus:border-emerald-300"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function TextArea({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-400">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows="4"
        className="mt-1 w-full rounded-lg border border-white/10 bg-pitch-900 px-3 py-3 text-base text-white outline-none focus:border-emerald-300"
      />
    </label>
  )
}
