import { Activity, DatabaseZap, Power, RefreshCcw, RotateCcw, Server, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getEnabledLeagues, getSyncLogs, updateLeagueSettings } from '../services/supabaseFootball'
import { formatUpdatedAt } from '../utils/formatters'

export default function AdminPage({ connection, syncing, error, onSync, onResetToday, onRefresh }) {
  const [leagues, setLeagues] = useState([])
  const [logs, setLogs] = useState([])
  const [loadingAdmin, setLoadingAdmin] = useState(false)
  const [adminError, setAdminError] = useState('')

  const loadAdminData = useCallback(async () => {
    setLoadingAdmin(true)
    setAdminError('')

    try {
      if (!connection.configured) {
        setLeagues([])
        setLogs([])
        return
      }

      const [leagueRows, logRows] = await Promise.all([getEnabledLeagues(), getSyncLogs()])
      setLeagues(leagueRows)
      setLogs(logRows)
    } catch (err) {
      setAdminError(err.message || 'Unable to load admin data')
    } finally {
      setLoadingAdmin(false)
    }
  }, [connection.configured])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadAdminData()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadAdminData])

  const syncAndReload = async () => {
    await onSync()
    await loadAdminData()
  }

  const updateLeague = async (league, patch) => {
    try {
      const updated = await updateLeagueSettings(league.id, {
        enabled: patch.enabled ?? league.enabled,
        priority: patch.priority ?? league.priority,
      })
      setLeagues((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    } catch (err) {
      setAdminError(err.message || 'Unable to update league')
    }
  }

  const visibleError = error || adminError

  return (
    <main className="app-page theme-admin">
      <section className="premium-hero p-4">
        <div className="relative z-10">
          <p className="eyebrow flex items-center gap-1.5">
            <DatabaseZap size={14} />
            Data Control Center
          </p>
          <h2 className="mt-1 text-3xl font-black leading-9 text-white">Sync Command</h2>
          <p className="mt-1 text-sm font-semibold text-slate-400">{connection.message}</p>

          <div className="mt-4 grid gap-2">
            <button type="button" onClick={syncAndReload} disabled={!connection.configured || syncing} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-300/18 font-black text-cyan-50 shadow-[0_0_26px_rgba(34,211,238,0.14)] disabled:opacity-50">
              <RefreshCcw size={18} />
              {syncing ? 'Syncing today...' : 'Sync Today'}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={onRefresh} className="premium-button flex items-center justify-center gap-2 px-2 text-xs">
                <RotateCcw size={16} />
                Load Supabase
              </button>
              <button type="button" onClick={onResetToday} disabled={!connection.configured || syncing} className="flex min-h-[42px] items-center justify-center gap-2 rounded-[14px] border border-amber-300/35 bg-amber-300/10 px-2 text-xs font-black text-amber-100 disabled:opacity-50">
                <RotateCcw size={16} />
                Reset
              </button>
            </div>
          </div>
        </div>
      </section>

      {visibleError ? (
        <section className="mt-3 rounded-2xl border border-red-400/30 bg-red-400/10 p-3">
          <p className="font-black text-red-100">Control warning</p>
          <p className="mt-1 text-sm leading-6 text-slate-200">{visibleError}</p>
        </section>
      ) : null}

      <section className="mt-3 glass-panel p-3.5">
        <h3 className="section-title flex items-center gap-2">
          <Server size={18} className="text-[var(--page-accent)]" />
          System Status
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatusTile label="Supabase" value={connection.configured ? 'Ready' : 'ENV needed'} ready={connection.configured} />
          <StatusTile label="Edge Function" value={connection.configured ? 'Manual sync' : 'Waiting'} ready={connection.configured} />
          <StatusTile label="Leagues" value={leagues.length} ready={leagues.length > 0} />
          <StatusTile label="Sync Logs" value={logs.length} ready={logs.length > 0} />
        </div>
      </section>

      <section className="mt-3 rounded-[20px] border border-white/10 bg-white/[0.035] p-3.5">
        <h3 className="section-title flex items-center gap-2">
          <SlidersHorizontal size={18} className="text-[var(--page-accent)]" />
          League Tracking
        </h3>
        {loadingAdmin ? <p className="mt-3 text-sm font-semibold text-slate-400">Loading league controls...</p> : null}
        {!loadingAdmin && !leagues.length ? <p className="mt-3 text-sm font-semibold text-slate-400">No tracked leagues found.</p> : null}
        <div className="mt-3 grid gap-2.5">
          {leagues.map((league) => (
            <article key={league.id} className="compact-card p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-black text-white">{league.name}</p>
                  <p className="text-xs font-semibold text-slate-500">{league.country || 'Unknown country'} · priority {league.priority}</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateLeague(league, { enabled: !league.enabled })}
                  className={`flex h-9 w-12 shrink-0 items-center rounded-full border p-1 transition ${league.enabled ? 'justify-end border-cyan-300/35 bg-cyan-300/15' : 'justify-start border-white/10 bg-white/10'}`}
                  aria-label={league.enabled ? 'Disable league' : 'Enable league'}
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full ${league.enabled ? 'bg-cyan-300 text-slate-950' : 'bg-slate-500 text-white'}`}>
                    <Power size={14} />
                  </span>
                </button>
              </div>
              <label className="mt-3 block">
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={league.priority}
                  onChange={(event) => updateLeague(league, { priority: event.target.value })}
                  className="h-7 w-full accent-cyan-300"
                />
              </label>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-3 rounded-[20px] border border-white/10 bg-white/[0.035] p-3.5">
        <h3 className="section-title flex items-center gap-2">
          <Activity size={18} className="text-[var(--page-accent)]" />
          Sync Logs
        </h3>
        {!logs.length ? <p className="mt-3 text-sm font-semibold text-slate-400">No sync history yet.</p> : null}
        <div className="mt-3 grid gap-2">
          {logs.map((log) => (
            <article key={log.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-2xl border border-white/10 bg-black/20 p-3">
              <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--page-accent)] shadow-[0_0_14px_var(--page-glow)]" />
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate font-black text-white">{log.status}</p>
                  <p className="shrink-0 text-[11px] font-semibold text-slate-500">{formatUpdatedAt(log.started_at)}</p>
                </div>
                <p className="mt-1 text-clamp-2 text-sm leading-6 text-slate-300">{log.message || '-'}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

function StatusTile({ label, value, ready }) {
  return (
    <div className="metric-display">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase text-slate-500">{label}</p>
        <span className={`h-2 w-2 rounded-full ${ready ? 'bg-cyan-300' : 'bg-amber-300'}`} />
      </div>
      <p className="mt-1 truncate text-lg font-black text-white">{value}</p>
    </div>
  )
}
