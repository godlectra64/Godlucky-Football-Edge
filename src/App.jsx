import { useEffect, useMemo, useState } from 'react'
import BottomNav from './components/BottomNav'
import MobileHeader from './components/MobileHeader'
import AdminPage from './pages/AdminPage'
import MatchDetailPage from './pages/MatchDetailPage'
import ResultTrackerPage from './pages/ResultTrackerPage'
import StatsPage from './pages/StatsPage'
import TodayPage from './pages/TodayPage'
import { getTopMatches } from './utils/analysisEngine'
import { loadMatches, resetMatches, saveMatches } from './utils/storage'

function App() {
  const [matches, setMatches] = useState(loadMatches)
  const [activePage, setActivePage] = useState('today')
  const topMatches = useMemo(() => getTopMatches(matches, 10), [matches])
  const [selectedMatchId, setSelectedMatchId] = useState(topMatches[0]?.id ?? matches[0]?.id)

  useEffect(() => {
    saveMatches(matches)
  }, [matches])

  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? topMatches[0] ?? matches[0]

  const updateMatch = (updatedMatch) => {
    setMatches((current) => current.map((match) => (match.id === updatedMatch.id ? updatedMatch : match)))
  }

  const saveMatch = (match) => {
    setMatches((current) => {
      const exists = current.some((item) => item.id === match.id)
      return exists ? current.map((item) => (item.id === match.id ? match : item)) : [match, ...current]
    })
    setSelectedMatchId(match.id)
  }

  const deleteMatch = (id) => {
    setMatches((current) => {
      const next = current.filter((match) => match.id !== id)
      if (selectedMatchId === id) setSelectedMatchId(next[0]?.id ?? '')
      return next
    })
  }

  const resetDemo = () => {
    const nextMatches = resetMatches()
    setMatches(nextMatches)
    setSelectedMatchId(nextMatches[0]?.id)
  }

  const openMatch = (id) => {
    setSelectedMatchId(id)
    setActivePage('analysis')
  }

  const titles = {
    today: 'คู่เด็ดวันนี้',
    analysis: 'รายละเอียดวิเคราะห์',
    admin: 'จัดการคู่บอล',
    results: 'บันทึกผล',
    stats: 'สถิติระบบ',
  }

  return (
    <div className="min-h-screen bg-pitch-950 text-slate-100">
      <MobileHeader title={titles[activePage]} subtitle="PWA วิเคราะห์บอลสำหรับ Android" />
      <div className="pb-24">
        {activePage === 'today' ? <TodayPage matches={matches} onOpenMatch={openMatch} /> : null}
        {activePage === 'analysis' ? (
          <MatchDetailPage
            match={selectedMatch}
            onBack={() => setActivePage('today')}
            onGoToday={() => setActivePage('today')}
            onUpdateMatch={updateMatch}
          />
        ) : null}
        {activePage === 'admin' ? (
          <AdminPage matches={matches} onSaveMatch={saveMatch} onDeleteMatch={deleteMatch} onResetDemo={resetDemo} />
        ) : null}
        {activePage === 'results' ? <ResultTrackerPage matches={matches} onUpdateMatch={updateMatch} /> : null}
        {activePage === 'stats' ? <StatsPage matches={matches} /> : null}
      </div>
      <BottomNav activePage={activePage} onNavigate={setActivePage} />
    </div>
  )
}

export default App
