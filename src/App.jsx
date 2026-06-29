import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import BottomNav from './components/BottomNav'
import MobileHeader from './components/MobileHeader'
import TodayPage from './pages/TodayPage'
import { getAiPerformanceData, getConnectionState, getLatestSyncLog, getMatchDetail, getResultTrackerData, getTodayMatches, resetTodayData, triggerManualSync } from './services/supabaseFootball'
import { getTodayTop10OrFallback } from './repositories/dailyTop10Repository'
import { getTopMatches } from './utils/analysisEngine'
import { getOneBestPickOfDay } from './utils/finalPick'
import { formatUpdatedAt } from './utils/formatters'
import { getMatchRoute } from './utils/matchDetail'
import { getPredictionReliability } from './utils/modelPerformanceAnalyzer'
import { getPerformanceContext } from './utils/performanceIntelligence'
import { getPagePath, getRouteState } from './utils/routes'
import { loadDevFallbackMatches } from './utils/storage'

const AdminPage = lazy(() => import('./pages/AdminPage'))
const AiPerformancePage = lazy(() => import('./pages/AiPerformancePage'))
const MatchDetailPage = lazy(() => import('./pages/MatchDetailPage'))
const ResultTrackerPage = lazy(() => import('./pages/ResultTrackerPage'))
const StatsPage = lazy(() => import('./pages/StatsPage'))

function App() {
  const connection = getConnectionState()
  const initialRoute = getRouteState(window.location.pathname)
  const [matches, setMatches] = useState([])
  const [totalAvailableMatches, setTotalAvailableMatches] = useState(0)
  const [top10Status, setTop10Status] = useState(null)
  const [top10Locked, setTop10Locked] = useState(false)
  const [activePage, setActivePage] = useState(() => initialRoute.activePage)
  const [selectedMatchId, setSelectedMatchId] = useState(() => initialRoute.selectedMatchId)
  const [detailMatch, setDetailMatch] = useState(null)
  const [detailLoading, setDetailLoading] = useState(() => Boolean(initialRoute.selectedMatchId))
  const [detailError, setDetailError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState('')
  const [performanceRows, setPerformanceRows] = useState([])
  const [resultRows, setResultRows] = useState([])
  const [performanceLoading, setPerformanceLoading] = useState(false)
  const [performanceError, setPerformanceError] = useState('')

  const loadToday = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const data = connection.configured ? await getTodayMatches() : await loadDevFallbackMatches()
      const board = connection.configured ? await getTodayTop10OrFallback(data) : { matches: data, status: null, locked: false }
      const trackerRows = connection.configured ? await getResultTrackerData() : []
      const latestSyncLog = connection.configured ? await getLatestSyncLog().catch(() => null) : null
      setMatches(board.matches)
      setResultRows(trackerRows)
      setTotalAvailableMatches(data.length)
      setTop10Status(board.status)
      setTop10Locked(Boolean(board.locked))
      setNotice(connection.configured ? 'ข้อมูลล่าสุดจาก Supabase' : 'ข้อมูล dev fallback เท่านั้น')
      setSelectedMatchId((current) => current || data[0]?.id || '')
      if (connection.configured) setNotice(buildLatestSyncNotice(latestSyncLog))
    } catch (err) {
      const fallbackData = await loadDevFallbackMatches().catch(() => [])
      setMatches(fallbackData)
      setResultRows([])
      setTotalAvailableMatches(fallbackData.length)
      setTop10Status(null)
      setTop10Locked(false)
      setError(err.message || 'โหลดข้อมูลไม่สำเร็จ')
      setNotice(fallbackData.length ? 'ใช้ข้อมูล fallback ล่าสุดหลัง Supabase query fail' : 'Supabase query fail และยังไม่มี fallback data')
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
      setPerformanceError(err.message || 'โหลดข้อมูลผลงาน AI ไม่สำเร็จ')
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
      const route = getRouteState(window.location.pathname)
      setSelectedMatchId(route.selectedMatchId)
      setDetailMatch(null)
      setDetailError('')
      setDetailLoading(Boolean(route.selectedMatchId))
      setActivePage(route.activePage)
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const visibleMatches = useMemo(
    () => top10Locked ? matches : [...matches].sort((a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt)),
    [matches, top10Locked],
  )
  const topMatches = useMemo(() => top10Locked ? visibleMatches : getTopMatches(visibleMatches, 10), [top10Locked, visibleMatches])
  const oneBestPick = useMemo(() => getOneBestPickOfDay(topMatches), [topMatches])
  const selectedMatch = detailMatch ?? matches.find((match) => match.id === selectedMatchId) ?? null
  const performanceContext = useMemo(() => {
    const version = selectedMatch?.analysis?.raw?.framework ?? selectedMatch?.analysis?.raw?.analysis_version ?? ''
    return getPerformanceContext(performanceRows, version)
  }, [performanceRows, selectedMatch])
  const predictionReliability = useMemo(() => getPredictionReliability(selectedMatch ?? {}, performanceRows), [performanceRows, selectedMatch])

  useEffect(() => {
    if (!selectedMatchId || !connection.configured) {
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
  }, [connection.configured, selectedMatchId])

  const openMatch = (id) => {
    setSelectedMatchId(id)
    setDetailMatch(null)
    setDetailError('')
    setDetailLoading(connection.configured)
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
    }
    window.history.pushState({}, '', getPagePath(page))
  }

  const runManualSync = async () => {
    setSyncing(true)
    setError('')

    try {
      await triggerManualSync()
      const data = await getTodayMatches()
      const board = await getTodayTop10OrFallback(data)
      setMatches(board.matches)
      setTotalAvailableMatches(data.length)
      setTop10Status(board.status)
      setTop10Locked(Boolean(board.locked))
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
      const board = await getTodayTop10OrFallback(data)
      setMatches(board.matches)
      setTotalAvailableMatches(data.length)
      setTop10Status(board.status)
      setTop10Locked(Boolean(board.locked))
      setNotice('รีเซ็ตและ sync ข้อมูลวันนี้สำเร็จ')
    } catch (err) {
      setError(err.message || 'รีเซ็ตข้อมูลวันนี้ไม่สำเร็จ')
      setNotice('ข้อมูลล่าสุดที่บันทึกไว้')
    } finally {
      setSyncing(false)
    }
  }

  const titles = {
    today: 'คู่เด่นวันนี้',
    analysis: 'วิเคราะห์คู่แข่งขัน',
    admin: 'จัดการข้อมูล',
    results: 'ผลย้อนหลัง',
    stats: 'สถิติภาพรวม',
    performance: 'ผลงาน AI',
    notFound: 'ไม่พบหน้านี้',
  }

  const themeClass = {
    today: 'theme-today',
    analysis: 'theme-analysis',
    admin: 'theme-admin',
    results: 'theme-results',
    stats: 'theme-stats',
    performance: 'theme-performance',
  }[activePage] ?? 'theme-today'

  return (
    <div className={`min-h-screen bg-[var(--bg-app)] text-slate-100 ${themeClass}`}>
      <MobileHeader title={titles[activePage]} subtitle="ข้อมูลสดจาก Supabase + วิเคราะห์ด้วย AI" connectionText={connection.message} activePage={activePage} />
      <div>
        {activePage === 'today' ? (
          <TodayPage
            matches={topMatches}
            oneBestPick={oneBestPick}
            totalMatchCount={totalAvailableMatches || visibleMatches.length}
            top10Status={top10Status}
            top10Locked={top10Locked}
            loading={loading}
            error={error}
            notice={notice}
            onRefresh={loadToday}
            onOpenMatch={openMatch}
          />
        ) : null}
        <Suspense fallback={<PageFallback />}>
          {activePage === 'analysis' ? (
            <MatchDetailPage match={selectedMatch} oneBestPick={oneBestPick} loading={detailLoading && connection.configured && !selectedMatch} error={detailError} performanceContext={performanceContext} predictionReliability={predictionReliability} onBack={goToday} onGoToday={goToday} />
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
          {activePage === 'results' ? <ResultTrackerPage matches={resultRows.length ? resultRows : matches} /> : null}
          {activePage === 'stats' ? <StatsPage matches={matches} /> : null}
          {activePage === 'performance' ? <AiPerformancePage rows={performanceRows} loading={performanceLoading} error={performanceError} onRefresh={loadPerformance} onOpenMatch={openMatch} /> : null}
        </Suspense>
        {activePage === 'notFound' ? <NotFoundPage onGoToday={goToday} /> : null}
      </div>
      <BottomNav activePage={activePage} onNavigate={navigatePage} />
    </div>
  )
}

function PageFallback() {
  return (
    <main className="app-page">
      <div className="empty-state">
        <p className="font-black text-white">กำลังโหลดหน้า</p>
        <p className="mt-1 text-sm leading-6 text-slate-300">กำลังเตรียมข้อมูลวิเคราะห์ฟุตบอล</p>
      </div>
    </main>
  )
}

function NotFoundPage({ onGoToday }) {
  return (
    <main className="app-page theme-today">
      <section className="empty-state">
        <p className="text-lg font-black text-white">ไม่พบหน้านี้</p>
        <p className="mt-2 text-sm leading-6 text-slate-300">ลิงก์นี้ยังไม่พร้อมใช้งาน แต่แอปยังใช้งานได้ตามปกติ</p>
        <button type="button" onClick={onGoToday} className="premium-button mt-4 px-5">
          กลับไปหน้าวันนี้
        </button>
      </section>
    </main>
  )
}

function buildLatestSyncNotice(log) {
  const syncedAt = log?.finished_at ?? log?.started_at
  if (!syncedAt) return 'ยังไม่พบ sync log ล่าสุด'
  if (log?.status === 'failed') return `sync ล่าสุดล้มเหลว ${formatUpdatedAt(syncedAt)}`
  if (log?.status === 'partial_success') return `sync ล่าสุดสำเร็จบางส่วน ${formatUpdatedAt(syncedAt)}`
  return `อัปเดตล่าสุด ${formatUpdatedAt(syncedAt)}`
}

export default App
