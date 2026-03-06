import { useCallback, useMemo } from 'react';
import { useLogStore } from '../stores/logStore';
import { useURLParams } from '../hooks/useURLParams';
import { LogDisplayView } from './LogDisplayView';
import { BurgerMenu } from '../components/BurgerMenu';
import { TimeRangeSelector } from '../components/TimeRangeSelector';
import { calculateTimeRangeMicros } from '../utils/timeUtils';

export function LogsView() {
  const { rawLogLines, startTime, endTime, uriFilter } = useLogStore();
  const { setUriFilter } = useURLParams();
  
  // Get filter from store (synced from URL via App.tsx)
  const filterPrefill = uriFilter ?? '';

  // Callback to update URL when filter changes
  const handleFilterChange = useCallback((filter: string) => {
    setUriFilter(filter || null);
  }, [setUriFilter]);

  // Filter log lines by time range only
  const filteredLines = useMemo(() => {
    if (rawLogLines.length === 0) return [];

    // Calculate time range with min/max log time as reference
    let minLogTimeUs = Infinity;
    let maxLogTimeUs = -Infinity;

    for (const line of rawLogLines) {
      const t = line.timestampUs;
      if (t > 0) {
        if (t < minLogTimeUs) minLogTimeUs = t;
        if (t > maxLogTimeUs) maxLogTimeUs = t;
      }
    }

    if (minLogTimeUs === Infinity) {
      minLogTimeUs = 0;
      maxLogTimeUs = 0;
    }

    const { startUs, endUs } = calculateTimeRangeMicros(startTime, endTime, minLogTimeUs, maxLogTimeUs);

    return rawLogLines.filter((line) => {
      // Time range filter only
      return line.timestampUs >= startUs && line.timestampUs <= endUs;
    });
  }, [rawLogLines, startTime, endTime]);

  // Calculate total (all raw log lines)
  const totalCount = rawLogLines.length;

  // For LogsView, define prev/next boundaries as the edges of filtered logs
  // This allows users to expand gaps to/from the start and end of the filtered set
  const prevRequestLineRange = filteredLines.length > 0 ? {
    start: filteredLines[0].lineNumber ?? 0,
    end: filteredLines[0].lineNumber ?? 0,
  } : undefined;

  const nextRequestLineRange = filteredLines.length > 0 ? {
    start: filteredLines[filteredLines.length - 1].lineNumber ?? (rawLogLines.length - 1),
    end: filteredLines[filteredLines.length - 1].lineNumber ?? (rawLogLines.length - 1),
  } : undefined;

  // Memoize transformed log lines to avoid rebuilding on every render
  const transformedLines = useMemo(() => 
    filteredLines.map(line => ({
      ...line,
      timestamp: line.displayTime
    })),
    [filteredLines]
  );

  return (
    <div className="app">
      <div className="header-compact">
        <div className="header-left">
          <BurgerMenu />
          <h1 className="header-title">
            All Logs
          </h1>
        </div>
        
        <div className="header-center">
          <div className="stats-compact">
            <span id="shown-count">{filteredLines.length}</span> / <span id="total-count">{totalCount}</span>
          </div>
        </div>
        
        <div className="header-right">
          <TimeRangeSelector />
        </div>
      </div>

      <div className="logs-view-container">
        <LogDisplayView 
          logLines={transformedLines}
          requestFilter={filterPrefill}
          onFilterChange={handleFilterChange}
          prevRequestLineRange={prevRequestLineRange}
          nextRequestLineRange={nextRequestLineRange}
        />
      </div>
    </div>
  );
}
