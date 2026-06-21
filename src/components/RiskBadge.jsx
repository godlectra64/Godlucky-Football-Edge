const styles = {
  ต่ำ: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200',
  กลาง: 'border-amber-300/35 bg-amber-300/10 text-amber-100',
  สูง: 'border-red-400/40 bg-red-400/15 text-red-100',
}

export default function RiskBadge({ level }) {
  return (
    <span className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-semibold ${styles[level] ?? styles.กลาง}`}>
      เสี่ยง{level}
    </span>
  )
}
