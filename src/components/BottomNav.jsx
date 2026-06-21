import { BarChart3, CalendarDays, ClipboardList, SlidersHorizontal, Trophy } from 'lucide-react'

const items = [
  { key: 'today', label: 'วันนี้', icon: CalendarDays },
  { key: 'analysis', label: 'วิเคราะห์', icon: ClipboardList },
  { key: 'admin', label: 'แอดมิน', icon: SlidersHorizontal },
  { key: 'results', label: 'ผลแข่ง', icon: Trophy },
  { key: 'stats', label: 'สถิติ', icon: BarChart3 },
]

export default function BottomNav({ activePage, onNavigate }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-pitch-950/95 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 backdrop-blur">
      <div className="mx-auto grid max-w-[430px] grid-cols-5 gap-1">
        {items.map(({ key, label, icon: Icon }) => {
          const active = activePage === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition ${
                active ? 'bg-emerald-400 text-pitch-950' : 'text-slate-400 hover:bg-white/10 hover:text-white'
              }`}
              aria-label={label}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
