import { Activity, Power, RefreshCcw, RotateCcw, Server, SlidersHorizontal } from 'lucide-react'
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
      setAdminError(err.message || 'โหลดข้อมูลแอดมินไม่สำเร็จ')
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
      setAdminError(err.message || 'แก้ไขลีกไม่สำเร็จ')
    }
  }

  return (
    <main className="mx-auto max-w-[430px] px-4 py-4">
      <section className="rounded-lg border border-white/10 bg-pitch-800 p-4">
        <h2 className="text-2xl font-black text-white">ศูนย์ควบคุมข้อมูล</h2>
        <p className="mt-1 text-sm text-slate-400">{connection.message}</p>
        <div className="mt-4 grid gap-2">
          <button
            type="button"
            onClick={syncAndReload}
            disabled={!connection.configured || syncing}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-emerald-400 font-bold text-pitch-950 disabled:opacity-50"
          >
            <RefreshCcw size={18} />
            {syncing ? 'กำลัง sync...' : 'Sync ข้อมูลวันนี้'}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/10 font-bold text-white"
          >
            <RotateCcw size={18} />
            โหลดจาก Supabase อีกครั้ง
          </button>
          <button
            type="button"
            onClick={onResetToday}
            disabled={!connection.configured || syncing}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-amber-300/40 bg-amber-300/10 font-bold text-amber-100 disabled:opacity-50"
          >
            <RotateCcw size={18} />
            รีเซ็ตข้อมูลวันนี้
          </button>
        </div>
      </section>

      {(error || adminError) ? (
        <section className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 p-4">
          <p className="font-bold text-red-100">พบข้อผิดพลาด</p>
          <p className="mt-1 text-sm leading-6 text-slate-200">{error || adminError}</p>
        </section>
      ) : null}

      <section className="mt-4 rounded-lg border border-white/10 bg-pitch-800 p-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-white">
          <Server size={20} />
          สถานะ API
        </h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatusTile label="Supabase" value={connection.configured ? 'พร้อม' : 'รอ ENV'} />
          <StatusTile label="Edge Function" value={connection.configured ? 'เรียกผ่านปุ่ม Sync' : 'ยังไม่พร้อม'} />
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-white/10 bg-pitch-800 p-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-white">
          <SlidersHorizontal size={20} />
          ลีกที่ติดตาม
        </h3>
        {loadingAdmin ? <p className="mt-3 text-sm text-slate-400">กำลังโหลดลีก...</p> : null}
        {!loadingAdmin && !leagues.length ? <p className="mt-3 text-sm text-slate-400">ยังไม่มีลีกในฐานข้อมูล</p> : null}
        <div className="mt-3 space-y-3">
          {leagues.map((league) => (
            <article key={league.id} className="rounded-lg bg-white/[0.04] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-white">{league.name}</p>
                  <p className="text-xs text-slate-400">{league.country || 'ไม่ระบุประเทศ'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateLeague(league, { enabled: !league.enabled })}
                  className={`flex min-h-10 min-w-10 items-center justify-center rounded-full ${
                    league.enabled ? 'bg-emerald-400 text-pitch-950' : 'bg-white/10 text-slate-300'
                  }`}
                  aria-label={league.enabled ? 'ปิดลีก' : 'เปิดลีก'}
                >
                  <Power size={17} />
                </button>
              </div>
              <label className="mt-3 block">
                <span className="text-xs text-slate-400">ลำดับความสำคัญ: {league.priority}</span>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={league.priority}
                  onChange={(event) => updateLeague(league, { priority: event.target.value })}
                  className="mt-2 h-8 w-full accent-emerald-400"
                />
              </label>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-white/10 bg-pitch-800 p-4">
        <h3 className="flex items-center gap-2 text-lg font-bold text-white">
          <Activity size={20} />
          Sync Logs
        </h3>
        {!logs.length ? <p className="mt-3 text-sm text-slate-400">ยังไม่มีประวัติ sync</p> : null}
        <div className="mt-3 space-y-3">
          {logs.map((log) => (
            <article key={log.id} className="rounded-lg bg-white/[0.04] p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-bold text-white">{log.status}</p>
                <p className="text-xs text-slate-400">{formatUpdatedAt(log.started_at)}</p>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-300">{log.message || '-'}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

function StatusTile({ label, value }) {
  return (
    <div className="rounded-lg bg-white/[0.05] p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 font-bold text-white">{value}</p>
    </div>
  )
}
