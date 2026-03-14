import { useCallback, useMemo } from 'react';
import { useLogStore } from '../stores/logStore';
import { useURLParams } from '../hooks/useURLParams';
import { LogDisplayView } from './LogDisplayView';
import { BurgerMenu } from '../components/BurgerMenu';
import { TimeRangeSelector } from '../components/TimeRangeSelector';
import { calculateTimeRangeMicros, getMinMaxTimestamps } from '../utils/timeUtils';

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

    const { min: minLogTimeUs, max: maxLogTimeUs } = getMinMaxTimestamps(rawLogLines);
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
          logLines={filteredLines}
          requestFilter={filterPrefill}
          onFilterChange={handleFilterChange}
          prevRequestLineRange={prevRequestLineRange}
          nextRequestLineRange={nextRequestLineRange}
        />
      </div>
    </div>
  );
}
