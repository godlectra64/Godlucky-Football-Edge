import { useCallback, useEffect, useMemo, useState } from 'react'
import BottomNav from './components/BottomNav'
import MobileHeader from './components/MobileHeader'
import AdminPage from './pages/AdminPage'
import AiPerformancePage from './pages/AiPerformancePage'
import MatchDetailPage from './pages/MatchDetailPage'
import ResultTrackerPage from './pages/ResultTrackerPage'
import StatsPage from './pages/StatsPage'
import TodayPage from './pages/TodayPage'
import { getAiPerformanceData, getConnectionState, getLatestSyncLog, getMatchDetail, getTodayMatches, resetTodayData, triggerManualSync } from './services/supabaseFootball'
import { getTopMatches } from './utils/analysisEngine'
import { formatUpdatedAt } from './utils/formatters'
import { getMatchRoute } from './utils/matchDetail'
import { getPredictionReliability } from './utils/modelPerformanceAnalyzer'
import { getPerformanceContext } from './utils/performanceIntelligence'
import { loadDevFallbackMatches } from './utils/storage'

function getRouteMatchId() {
  const match = window.location.pathname.match(/^\/match\/([^/]+)$/)
  return match ? decodeURIComponent(match[1]) : ''
}

function App() {
  const connection = getConnectionState()
  const [matches, setMatches] = useState([])
  const [activePage, setActivePage] = useState(() => (getRouteMatchId() ? 'analysis' : 'today'))
  const [selectedMatchId, setSelectedMatchId] = useState(() => getRouteMatchId())
  const [detailMatch, setDetailMatch] = useState(null)
  const [detailLoading, setDetailLoading] = useState(() => Boolean(getRouteMatchId()))
  const [detailError, setDetailError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState('')
  const [performanceRows, setPerformanceRows] = useState([])
  const [performanceLoading, setPerformanceLoading] = useState(false)
  const [performanceError, setPerformanceError] = useState('')

  const loadToday = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const data = connection.configured ? await getTodayMatches() : await loadDevFallbackMatches()
      const latestSyncLog = connection.configured ? await getLatestSyncLog().catch(() => null) : null
      setMatches(data)
      setNotice(connection.configured ? 'ข้อมูลล่าสุดจาก Supabase' : 'ข้อมูล dev fallback เท่านั้น')
      setSelectedMatchId((current) => current || data[0]?.id || '')
      if (connection.configured) setNotice(buildLatestSyncNotice(latestSyncLog))
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

  const loadPerformance = useCallback(async () => {
    if (!connection.configured) {
      setPerformanceRows([])
      return
    }

    setPerformanceLoading(true)
    setPerformanceError('')
    try {
      setPerformanceRows(await getAiPerformanceData())
    } catch (err) {
      setPerformanceError(err.message || 'โหลดข้อมูล AI Performance ไม่สำเร็จ')
    } finally {
      setPerformanceLoading(false)
    }
  }, [connection.configured])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadPerformance()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadPerformance])

  useEffect(() => {
    const onPopState = () => {
      const routeMatchId = getRouteMatchId()
      setSelectedMatchId(routeMatchId)
      setDetailMatch(null)
      setDetailError('')
      setDetailLoading(Boolean(routeMatchId))
      setActivePage(routeMatchId ? 'analysis' : 'today')
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const visibleMatches = useMemo(
    () => [...matches].sort((a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt)),
    [matches],
  )
  const topMatches = useMemo(() => getTopMatches(visibleMatches, 10), [visibleMatches])
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? detailMatch ?? null
  const performanceContext = useMemo(() => {
    const version = selectedMatch?.analysis?.raw?.framework ?? selectedMatch?.analysis?.raw?.analysis_version ?? ''
    return getPerformanceContext(performanceRows, version)
  }, [performanceRows, selectedMatch])
  const predictionReliability = useMemo(() => getPredictionReliability(selectedMatch ?? {}, performanceRows), [performanceRows, selectedMatch])

  useEffect(() => {
    if (!selectedMatchId || matches.some((match) => match.id === selectedMatchId) || !connection.configured) {
      return
    }

    let active = true
    getMatchDetail(selectedMatchId)
      .then((match) => {
        if (active) setDetailMatch(match)
      })
      .catch((err) => {
        if (active) setDetailError(err.message || 'โหลดรายละเอียดคู่แข่งขันไม่สำเร็จ')
      })
      .finally(() => {
        if (active) setDetailLoading(false)
      })

    return () => {
      active = false
    }
  }, [connection.configured, matches, selectedMatchId])

  const openMatch = (id) => {
    setSelectedMatchId(id)
    setDetailMatch(null)
    setDetailError('')
    setDetailLoading(connection.configured && !matches.some((match) => match.id === id))
    setActivePage('analysis')
    window.history.pushState({}, '', getMatchRoute(id))
  }

  const goToday = () => {
    setActivePage('today')
    setSelectedMatchId('')
    setDetailMatch(null)
    setDetailError('')
    setDetailLoading(false)
    window.history.pushState({}, '', '/')
  }

  const navigatePage = (page) => {
    setActivePage(page)
    if (page !== 'analysis') {
      setSelectedMatchId('')
      setDetailMatch(null)
      setDetailError('')
      setDetailLoading(false)
      window.history.pushState({}, '', '/')
    }
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

  titles.performance = 'AI Performance'

  return (
    <div className="min-h-screen bg-pitch-950 text-slate-100">
      <MobileHeader title={titles[activePage]} subtitle="ข้อมูลจริงจาก Supabase และ Edge Function" connectionText={connection.message} />
      <div className="pb-24">
        {activePage === 'today' ? (
          <TodayPage
            matches={topMatches}
            totalMatchCount={visibleMatches.length}
            loading={loading}
            error={error}
            notice={notice}
            onRefresh={loadToday}
            onOpenMatch={openMatch}
          />
        ) : null}
        {activePage === 'analysis' ? (
          <MatchDetailPage match={selectedMatch} loading={detailLoading && connection.configured && !selectedMatch} error={detailError} performanceContext={performanceContext} predictionReliability={predictionReliability} onBack={goToday} onGoToday={goToday} />
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
        {activePage === 'performance' ? <AiPerformancePage rows={performanceRows} loading={performanceLoading} error={performanceError} onRefresh={loadPerformance} /> : null}
      </div>
      <BottomNav activePage={activePage} onNavigate={navigatePage} />
    </div>
  )
}

function buildLatestSyncNotice(log) {
  const syncedAt = log?.finished_at ?? log?.started_at
  if (!syncedAt) return 'ยังไม่พบ sync log ล่าสุด'
  if (log?.status === 'failed') return `sync ล่าสุดล้มเหลวเมื่อ ${formatUpdatedAt(syncedAt)}`
  if (log?.status === 'partial_success') return `sync ล่าสุดสำเร็จบางส่วนเมื่อ ${formatUpdatedAt(syncedAt)}`
  return `ข้อมูลล่าสุดเมื่อ ${formatUpdatedAt(syncedAt)}`
}

export default App
