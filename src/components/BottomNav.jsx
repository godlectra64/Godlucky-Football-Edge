import { Activity, BarChart3, CalendarDays, ClipboardList, SlidersHorizontal, Trophy } from 'lucide-react'

const items = [
  { key: 'today', label: 'วันนี้', icon: CalendarDays },
  { key: 'analysis', label: 'วิเคราะห์', icon: ClipboardList },
  { key: 'admin', label: 'แอดมิน', icon: SlidersHorizontal },
  { key: 'results', label: 'ผลแข่ง', icon: Trophy },
  { key: 'stats', label: 'สถิติ', icon: BarChart3 },
]

items.push({ key: 'performance', label: 'AI', icon: Activity })

export default function BottomNav({ activePage, onNavigate }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-pitch-950/95 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 shadow-[0_-16px_42px_rgba(0,0,0,0.35)] backdrop-blur">
      <div className="mx-auto grid max-w-[430px] grid-cols-6 gap-1.5">
        {items.map(({ key, label, icon: Icon }) => {
          const active = activePage === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-bold leading-none transition duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-300/50 ${
                active ? 'bg-emerald-400 text-pitch-950 shadow-[0_0_18px_rgba(52,211,153,0.22)]' : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
              aria-label={label}
            >
              <Icon size={20} />
              <span className="max-w-full truncate">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
