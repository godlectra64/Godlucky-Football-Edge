import { Activity, BarChart3, CalendarDays, ClipboardList, SlidersHorizontal, Trophy } from 'lucide-react'

const items = [
  { key: 'today', label: 'วันนี้', icon: CalendarDays },
  { key: 'analysis', label: 'วิเคราะห์', icon: ClipboardList },
  { key: 'admin', label: 'แอดมิน', icon: SlidersHorizontal },
  { key: 'results', label: 'ผลแข่ง', icon: Trophy },
  { key: 'stats', label: 'สถิติ', icon: BarChart3 },
  { key: 'performance', label: 'AI', icon: Activity },
]

const activeStyles = {
  today: 'border-emerald-300/40 bg-emerald-300/15 text-emerald-50 shadow-[0_0_20px_rgba(52,211,153,0.18)]',
  analysis: 'border-blue-300/40 bg-blue-300/15 text-blue-50 shadow-[0_0_20px_rgba(96,165,250,0.18)]',
  stats: 'border-purple-300/40 bg-purple-300/15 text-purple-50 shadow-[0_0_20px_rgba(167,139,250,0.18)]',
  performance: 'border-amber-300/40 bg-amber-300/15 text-amber-50 shadow-[0_0_20px_rgba(246,196,69,0.16)]',
  default: 'border-white/15 bg-white/10 text-white',
}

export default function BottomNav({ activePage, onNavigate }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#05080d]/95 px-2 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2 shadow-[0_-18px_46px_rgba(0,0,0,0.42)] backdrop-blur-xl">
      <div className="mx-auto grid max-w-[430px] grid-cols-6 gap-1.5">
        {items.map(({ key, label, icon: Icon }) => {
          const active = activePage === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-[10px] font-bold leading-none transition duration-200 focus:outline-none focus:ring-2 focus:ring-white/30 ${
                active ? activeStyles[key] ?? activeStyles.default : 'border-transparent text-slate-400 hover:border-white/10 hover:bg-white/10 hover:text-white'
              }`}
              aria-label={label}
            >
              <Icon size={active ? 21 : 20} strokeWidth={active ? 2.5 : 2} />
              <span className="max-w-full truncate">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
