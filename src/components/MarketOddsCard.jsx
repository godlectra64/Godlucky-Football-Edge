import { LineChart } from 'lucide-react'
import { formatMarketFocus } from '../utils/uiLabels'

const compactMarkets = ['AH', 'OU']
const expandedMarkets = ['AH', 'OU', 'MATCH_WINNER', 'BTTS']

export default function MarketOddsCard({ odds = [], compact = false }) {
  const rows = odds.filter(Boolean)
  const latestAt = getLatestSnapshot(rows)
  const bookmaker = rows.find((row) => row.bookmaker)?.bookmaker ?? 'API-FOOTBALL'
  const markets = compact ? compactMarkets : expandedMarkets
  const grouped = markets.map((market) => ({ market, rows: getRowsForMarket(rows, market) }))

  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.04] ${compact ? 'p-2.5' : 'p-3'}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-sm font-black text-white">
          <LineChart size={16} className="shrink-0 text-[var(--page-accent)]" />
          <span className="truncate">สัญญาณตลาดจาก AI</span>
        </p>
        <span className="semantic-badge border-white/10 bg-white/[0.05] text-slate-200">{rows.length ? `${rows.length} ราคา` : 'ยังไม่มีข้อมูล'}</span>
      </div>

      {rows.length ? (
        <>
          <div className={`mt-3 grid gap-2 ${compact ? '' : 'sm:grid-cols-2'}`}>
            {grouped.map(({ market, rows: marketRows }) => (
              <MarketBlock key={market} market={market} rows={marketRows} compact={compact} />
            ))}
          </div>
          <p className="mt-2 text-clamp-1 text-[11px] font-semibold text-slate-500">
            เจ้ามือ: {bookmaker} · อัปเดต {latestAt ? formatOddsTime(latestAt) : '-'}
          </p>
        </>
      ) : (
        <p className="mt-3 rounded-xl border border-slate-400/20 bg-slate-400/10 px-3 py-2 text-sm leading-6 text-slate-300">ยังไม่มีข้อมูลตลาดราคา</p>
      )}
    </div>
  )
}

function MarketBlock({ market, rows, compact }) {
  const primary = rows[0] ?? null
  if (!primary) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/15 px-3 py-2">
        <p className="text-[10px] font-black uppercase text-slate-500">{market}</p>
        <p className="mt-1 text-xs font-bold text-slate-400">ยังไม่มีข้อมูลตลาดราคา</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/15 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase text-slate-500">{marketLabel(market)}</p>
          <p className="mt-1 truncate text-sm font-black text-white">{formatMarketLine(primary)}</p>
        </div>
        <span className="shrink-0 text-sm font-black text-[var(--page-accent)]">{primary.oddText ?? primary.price ?? '-'}</span>
      </div>
      {!compact && rows.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {rows.slice(1, 4).map((row) => (
            <span key={`${row.marketFocus}-${row.selection}-${row.bookmaker}-${row.oddText}`} className="semantic-badge border-white/10 bg-white/[0.04] text-slate-300">
              {row.selection ?? row.marketName} @ {row.oddText ?? row.price ?? '-'}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function getRowsForMarket(rows, market) {
  return rows
    .filter((row) => row.marketFocus === market)
    .sort((a, b) => {
      const latestDiff = Number(Boolean(b.isLatest)) - Number(Boolean(a.isLatest))
      const timeDiff = new Date(b.snapshotAt ?? 0).getTime() - new Date(a.snapshotAt ?? 0).getTime()
      return latestDiff || timeDiff
    })
    .slice(0, 4)
}

function getLatestSnapshot(rows) {
  return rows
    .map((row) => row.snapshotAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null
}

function formatMarketLine(row) {
  const selection = row.selection ?? row.marketName ?? row.marketFocus
  const line = row.line !== null && row.line !== undefined ? ` ${row.line}` : ''
  return `${selection}${line}`.trim()
}

function marketLabel(market) {
  return formatMarketFocus(market)
}

function formatOddsTime(value) {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
