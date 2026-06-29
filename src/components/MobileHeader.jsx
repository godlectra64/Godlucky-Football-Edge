import { Cloud, ShieldCheck } from 'lucide-react'

const themeClass = {
  today: 'theme-today',
  analysis: 'theme-analysis',
  admin: 'theme-admin',
  results: 'theme-results',
  stats: 'theme-stats',
  performance: 'theme-performance',
}

export default function MobileHeader({ title, subtitle, connectionText, activePage = 'today' }) {
  const theme = themeClass[activePage] ?? 'theme-today'

  return (
    <header className={`sticky top-0 z-30 border-b border-white/10 bg-[rgba(3,6,9,0.88)] px-3 pb-2 pt-[calc(env(safe-area-inset-top)+7px)] shadow-[0_12px_34px_rgba(0,0,0,0.34)] backdrop-blur-xl ${theme}`}>
      <div className="mx-auto flex max-w-[480px] items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[13px] border border-[rgba(var(--page-accent-rgb),0.32)] bg-[rgba(var(--page-accent-rgb),0.12)] text-[var(--page-accent)]">
          <ShieldCheck size={18} strokeWidth={2.5} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-black uppercase leading-4 text-[var(--page-accent)]">GODLUCKY FOOTBALL EDGE</p>
          <h1 className="truncate text-[0.95rem] font-black leading-5 text-white">{title}</h1>
          {subtitle ? <p className="truncate text-[10.5px] font-semibold leading-4 text-slate-500">{subtitle}</p> : null}
        </div>
        {connectionText ? (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-slate-400" title={connectionText}>
            <Cloud size={15} />
          </div>
        ) : null}
      </div>
    </header>
  )
}
