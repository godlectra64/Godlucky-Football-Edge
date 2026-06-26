const routeMap = {
  today: '/',
  analysis: '/analysis',
  admin: '/admin',
  results: '/results',
  stats: '/stats',
  performance: '/performance',
}

export function getRouteState(pathname = '/') {
  const path = normalizePath(pathname)
  const match = path.match(/^\/match\/([^/]+)$/)

  if (match) {
    return {
      activePage: 'analysis',
      selectedMatchId: safeDecode(match[1]),
      notFound: false,
      path,
    }
  }

  if (path === '/' || path === '/today') return buildPageRoute('today', path)
  if (path === '/performance' || path === '/ai-performance') return buildPageRoute('performance', path)
  if (path === '/analysis') return buildPageRoute('analysis', path)
  if (path === '/admin') return buildPageRoute('admin', path)
  if (path === '/results') return buildPageRoute('results', path)
  if (path === '/stats') return buildPageRoute('stats', path)

  return {
    activePage: 'notFound',
    selectedMatchId: '',
    notFound: true,
    path,
  }
}

export function getPagePath(page) {
  return routeMap[page] ?? '/'
}

function buildPageRoute(activePage, path) {
  return {
    activePage,
    selectedMatchId: '',
    notFound: false,
    path,
  }
}

function normalizePath(pathname) {
  const path = `/${String(pathname || '/').split('?')[0].split('#')[0].replace(/^\/+/, '')}`
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
