import { Cloud, ShieldCheck } from 'lucide-react'

const themeStyles = {
  today: 'theme-today text-emerald-200 border-emerald-300/25 bg-emerald-300/10',
  analysis: 'theme-analysis text-blue-200 border-blue-300/25 bg-blue-300/10',
  stats: 'theme-stats text-purple-200 border-purple-300/25 bg-purple-300/10',
  performance: 'theme-performance text-amber-200 border-amber-300/25 bg-amber-300/10',
  default: 'theme-today text-emerald-200 border-emerald-300/25 bg-emerald-300/10',
}

export default function MobileHeader({ title, subtitle, connectionText, activePage = 'today' }) {
  const theme = themeStyles[activePage] ?? themeStyles.default

  return (
    <header className={`sticky top-0 z-30 border-b border-white/10 bg-[#05080d]/92 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] shadow-[0_10px_32px_rgba(0,0,0,0.28)] backdrop-blur-xl ${theme.split(' ')[0]}`}>
      <div className="mx-auto flex max-w-[430px] items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${theme}`}>
          <ShieldCheck size={23} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow uppercase">Godlucky Football Edge</p>
          <h1 className="truncate text-lg font-black leading-6 text-white">{title}</h1>
          {subtitle ? <p className="truncate text-xs font-medium text-slate-400">{subtitle}</p> : null}
        </div>
        {connectionText ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/10 text-slate-300" title={connectionText}>
            <Cloud size={17} />
          </div>
        ) : null}
      </div>
    </header>
  )
}
