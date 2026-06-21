import { Cloud, ShieldCheck } from 'lucide-react'

export default function MobileHeader({ title, subtitle, connectionText }) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-pitch-950/95 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] backdrop-blur">
      <div className="mx-auto flex max-w-[430px] items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-200">
          <ShieldCheck size={23} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase text-emerald-200">Godlucky Football Edge</p>
          <h1 className="truncate text-lg font-bold text-white">{title}</h1>
          {subtitle ? <p className="truncate text-xs text-slate-400">{subtitle}</p> : null}
        </div>
        {connectionText ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-slate-300" title={connectionText}>
            <Cloud size={17} />
          </div>
        ) : null}
      </div>
    </header>
  )
}
