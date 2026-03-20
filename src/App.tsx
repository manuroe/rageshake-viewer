import { useEffect, useRef } from 'react';
import {
  HashRouter as Router,
  Routes,
  Route,
  useSearchParams,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { LandingPage } from './views/LandingPage';
import { SummaryView } from './views/SummaryView';
import { SyncView } from './views/SyncView';
import { HttpRequestsView } from './views/HttpRequestsView';
import { LogsView } from './views/LogsView';
import { useLogStore } from './stores/logStore';
import { urlToTimeFormat } from './utils/timeUtils';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DEFAULT_MS_PER_PIXEL } from './utils/timelineUtils';
import { parseStatusParam } from './hooks/useURLParams';
import { KeyboardShortcutProvider } from './components/KeyboardShortcutProvider';
import { ShortcutHelpOverlay, ChordToast } from './components/ShortcutHelpOverlay';
import { useExtensionFile } from './hooks/useExtensionFile';

function AppContent() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { rawLogLines, setLastRoute } = useLogStore();
  
  // Ref to prevent redirect loops
  const isRedirecting = useRef(false);

  // Load log file passed by the browser extension (no-op outside extension context).
  useExtensionFile();

  // Reset redirect flag when location changes
  useEffect(() => {
    isRedirecting.current = false;
  }, [location.pathname, location.search]);

  // Single effect: URL → Store (one direction only)
  // Components write to URL, this effect syncs URL to store
  useEffect(() => {
    // Don't sync if there's no data - redirect will handle it
    if (rawLogLines.length === 0) {
      return;
    }

    const store = useLogStore.getState();
    const start = urlToTimeFormat(searchParams.get('start'));
    const end = urlToTimeFormat(searchParams.get('end'));
    const scaleParam = searchParams.get('scale');
    const scale = scaleParam ? parseInt(scaleParam, 10) : DEFAULT_MS_PER_PIXEL;
    const status = parseStatusParam(searchParams.get('status'));
    const filter = searchParams.get('filter');
    const requestId = searchParams.get('request_id');
    const timeoutParam = searchParams.get('timeout');
    const timeout = timeoutParam !== null ? parseInt(timeoutParam, 10) : null;

    // Update store (derived from URL)
    store.setTimeFilter(start, end);
    if (!isNaN(scale) && scale > 0) {
      store.setTimelineScale(scale);
    }
    store.setStatusCodeFilter(status);
    store.setLogFilter(filter);
    store.setSelectedTimeout(!isNaN(timeout ?? NaN) ? timeout : null);
    // When request_id is absent, clear the selection.
    // When present, each view's useUrlRequestAutoScroll handles opening by rowKey.
    if (requestId === null) {
      store.setActiveRequest(null);
    }
  }, [searchParams, rawLogLines.length]);

  // Track last route for "continue where you left off"
  useEffect(() => {
    const fullPath = `${location.pathname}${location.search}${location.hash}`;
    if (location.pathname !== '/') {
      setLastRoute(fullPath);
    }
  }, [location.pathname, location.search, location.hash, setLastRoute]);

  // Redirect to landing if no data
  useEffect(() => {
    const hasData = rawLogLines.length > 0;
    if (!hasData && location.pathname !== '/' && !isRedirecting.current) {
      isRedirecting.current = true;
      void navigate('/', { replace: true });
    }
  }, [rawLogLines.length, location.pathname, navigate]);

  return (
    <KeyboardShortcutProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/summary" element={<SummaryView />} />
        <Route path="/logs" element={<LogsView />} />
        <Route path="/http_requests" element={<HttpRequestsView />} />
        <Route path="/http_requests/sync" element={<SyncView />} />
      </Routes>
      <ShortcutHelpOverlay />
      <ChordToast />
    </KeyboardShortcutProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <AppContent />
      </Router>
    </ErrorBoundary>
  );
}

export default App;
