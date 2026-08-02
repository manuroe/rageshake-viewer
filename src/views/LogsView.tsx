import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLogStore } from '../stores/logStore';
import { useURLParams } from '../hooks/useURLParams';
import { LogDisplayView } from './LogDisplayView';
import { BurgerMenu } from '../components/BurgerMenu';
import { TimeRangeSelector } from '../components/TimeRangeSelector';
import { calculateTimeRangeMicros, getMinMaxTimestamps } from '../utils/timeUtils';

/**
 * Parse the `line` URL param into an inclusive highlight range.
 * Returns undefined for anything malformed, so a bad link degrades to "no
 * highlight" rather than an error screen.
 *
 * @example parseLineParam('1234')      // { start: 1234, end: 1234 }
 * @example parseLineParam('1234-1240') // { start: 1234, end: 1240 }
 */
function parseLineParam(lineParam: string | null): { start: number; end: number } | undefined {
  if (lineParam === null) return undefined;
  const match = /^(\d+)(?:-(\d+))?$/.exec(lineParam);
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  if (start < 1 || end < start) return undefined;
  return { start, end };
}

export function LogsView() {
  const { rawLogLines, startTime, endTime, logFilter } = useLogStore();
  const { setLogFilter } = useURLParams();
  const [searchParams] = useSearchParams();

  // Get filter from store (synced from URL via App.tsx)
  const filterPrefill = logFilter ?? '';

  // Optional `line` param: highlight and scroll to a specific line ('1234'), or
  // to an inclusive range of them ('1234-1240'). Used by the overview
  // drilldown's "Open in Logs view" button and by report deep links. Accept only
  // strictly positive integers, ascending — reject '', '12abc', '0', '-1',
  // '1.5', '9-2' (parseInt would silently accept partial/zero/negative values).
  const lineParam = searchParams.get('line');
  const highlightLines = useMemo(() => parseLineParam(lineParam), [lineParam]);

  // Callback to update URL when filter changes
  const handleFilterChange = useCallback((filter: string) => {
    setLogFilter(filter || null);
  }, [setLogFilter]);

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
            Logs
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
          highlightLines={highlightLines}
          showAnonymizeButton
        />
      </div>
    </div>
  );
}
