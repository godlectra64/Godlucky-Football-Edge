import { Activity, BarChart3, CalendarDays, ClipboardList, SlidersHorizontal, Trophy } from 'lucide-react'

const items = [
  { key: 'today', label: 'Today', icon: CalendarDays, className: 'theme-today' },
  { key: 'analysis', label: 'Analysis', icon: ClipboardList, className: 'theme-analysis' },
  { key: 'admin', label: 'Admin', icon: SlidersHorizontal, className: 'theme-admin' },
  { key: 'results', label: 'Results', icon: Trophy, className: 'theme-results' },
  { key: 'stats', label: 'Stats', icon: BarChart3, className: 'theme-stats' },
  { key: 'performance', label: 'AI', icon: Activity, className: 'theme-performance' },
]

export default function BottomNav({ activePage, onNavigate }) {
  return (
    <nav className="native-bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[rgba(3,6,9,0.9)] px-2 pt-2 shadow-[0_-18px_48px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <div className="mx-auto grid max-w-[430px] grid-cols-6 gap-1">
        {items.map(({ key, label, icon: Icon, className }) => {
          const active = activePage === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              className={`premium-focus ${className} flex min-h-[54px] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border px-1 text-[10px] font-black leading-none transition duration-200 ${
                active
                  ? 'border-[rgba(var(--page-accent-rgb),0.42)] bg-[rgba(var(--page-accent-rgb),0.14)] text-white shadow-[0_0_22px_var(--page-glow)]'
                  : 'border-transparent text-slate-500 hover:bg-white/[0.06] hover:text-slate-200'
              }`}
              aria-label={label}
            >
              <Icon size={active ? 20 : 19} strokeWidth={active ? 2.6 : 2.1} className={active ? 'text-[var(--page-accent)]' : ''} />
              <span className="max-w-full truncate">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
