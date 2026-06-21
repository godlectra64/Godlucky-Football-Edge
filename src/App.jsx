import { useCallback, useEffect, useMemo, useState } from 'react'
import BottomNav from './components/BottomNav'
import MobileHeader from './components/MobileHeader'
import AdminPage from './pages/AdminPage'
import MatchDetailPage from './pages/MatchDetailPage'
import ResultTrackerPage from './pages/ResultTrackerPage'
import StatsPage from './pages/StatsPage'
import TodayPage from './pages/TodayPage'
import { getConnectionState, getTodayMatches, resetTodayData, triggerManualSync } from './services/supabaseFootball'
import { loadDevFallbackMatches } from './utils/storage'

function App() {
  const connection = getConnectionState()
  const [matches, setMatches] = useState([])
  const [activePage, setActivePage] = useState('today')
  const [selectedMatchId, setSelectedMatchId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState('')

  const loadToday = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const data = connection.configured ? await getTodayMatches() : await loadDevFallbackMatches()
      setMatches(data)
      setNotice(connection.configured ? 'ข้อมูลล่าสุดจาก Supabase' : 'ข้อมูล dev fallback เท่านั้น')
      setSelectedMatchId((current) => current || data[0]?.id || '')
    } catch (err) {
      setError(err.message || 'โหลดข้อมูลไม่สำเร็จ')
      setNotice('ข้อมูลล่าสุดที่บันทึกไว้')
    } finally {
      setLoading(false)
    }
  }, [connection.configured])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadToday()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadToday])

  const visibleMatches = useMemo(
    () => [...matches].sort((a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt)),
    [matches],
  )
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? visibleMatches[0] ?? matches[0]

  const openMatch = (id) => {
    setSelectedMatchId(id)
    setActivePage('analysis')
  }

  const runManualSync = async () => {
    setSyncing(true)
    setError('')

    try {
      await triggerManualSync()
      const data = await getTodayMatches()
      setMatches(data)
      setNotice('sync สำเร็จและโหลดข้อมูลล่าสุดแล้ว')
    } catch (err) {
      setError(err.message || 'sync ไม่สำเร็จ')
      setNotice('ข้อมูลล่าสุดที่บันทึกไว้')
    } finally {
      setSyncing(false)
    }
  }

  const runResetToday = async () => {
    setSyncing(true)
    setError('')

    try {
      await resetTodayData()
      const data = await getTodayMatches()
      setMatches(data)
      setNotice('รีเซ็ตและ sync ข้อมูลวันนี้สำเร็จ')
    } catch (err) {
      setError(err.message || 'รีเซ็ตข้อมูลวันนี้ไม่สำเร็จ')
      setNotice('ข้อมูลล่าสุดที่บันทึกไว้')
    } finally {
      setSyncing(false)
    }
  }

  const titles = {
    today: 'รายการคู่จริง',
    analysis: 'รายละเอียดวิเคราะห์',
    admin: 'ศูนย์ควบคุมข้อมูล',
    results: 'ผลการแข่งขัน',
    stats: 'สถิติระบบ',
  }

  return (
    <div className="min-h-screen bg-pitch-950 text-slate-100">
      <MobileHeader title={titles[activePage]} subtitle="ข้อมูลจริงจาก Supabase และ Edge Function" connectionText={connection.message} />
      <div className="pb-24">
        {activePage === 'today' ? (
          <TodayPage
            matches={visibleMatches}
            loading={loading}
            error={error}
            notice={notice}
            onRefresh={loadToday}
            onOpenMatch={openMatch}
          />
        ) : null}
        {activePage === 'analysis' ? (
          <MatchDetailPage match={selectedMatch} onBack={() => setActivePage('today')} onGoToday={() => setActivePage('today')} />
        ) : null}
        {activePage === 'admin' ? (
          <AdminPage
            connection={connection}
            loading={loading}
            syncing={syncing}
            error={error}
            onSync={runManualSync}
            onResetToday={runResetToday}
            onRefresh={loadToday}
          />
        ) : null}
        {activePage === 'results' ? <ResultTrackerPage matches={matches} /> : null}
        {activePage === 'stats' ? <StatsPage matches={matches} /> : null}
      </div>
      <BottomNav activePage={activePage} onNavigate={setActivePage} />
    </div>
  )
}

export default App
