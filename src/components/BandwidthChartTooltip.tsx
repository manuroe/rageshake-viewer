import type { ActivityBucket } from './BaseActivityChart';
import { formatBytes } from '../utils/sizeUtils';

/** Blue — consistent with the "outgoing/send" direction convention. */
const UPLOAD_COLOR = 'var(--bandwidth-upload)';

/** Orange — distinct from the upload blue and from HTTP status greens/reds. */
const DOWNLOAD_COLOR = 'var(--bandwidth-download)';

/**
 * Bucket type for the bandwidth stacked bar chart, extending the generic
 * {@link ActivityBucket} with per-bucket upload and download byte totals.
 *
 * Kept in a separate file from {@link BandwidthChart} so it can be exported
 * for direct unit-testing without violating the react-refresh rule that
 * component files should only export components.
 */
export interface BandwidthBucket extends ActivityBucket {
  uploadBytes: number;
  downloadBytes: number;
}

/**
 * Renders the tooltip content for a single bandwidth bar.
 *
 * Extracted as a module-level function (rather than an inline useCallback) so
 * it can be unit-tested directly without needing to simulate SVG mouse hover
 * events in jsdom.
 *
 * @example
 * render(renderBandwidthTooltip({
 *   timestamp: 0,
 *   timeLabel: '00:00:01',
 *   total: 1536,
 *   uploadBytes: 512,
 *   downloadBytes: 1024,
 * }));
 */
export function renderBandwidthTooltip(bucket: BandwidthBucket): React.ReactElement {
  return (
    <>
      <div style={{ marginBottom: '2px', fontWeight: 'bold', fontSize: '10px' }}>
        {bucket.timeLabel}
      </div>
      {bucket.downloadBytes > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '1px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              backgroundColor: DOWNLOAD_COLOR,
              borderRadius: '1px',
            }}
          />
          <span style={{ fontSize: '9px' }}>↓ Download: {formatBytes(bucket.downloadBytes)}</span>
        </div>
      )}
      {bucket.uploadBytes > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '1px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              backgroundColor: UPLOAD_COLOR,
              borderRadius: '1px',
            }}
          />
          <span style={{ fontSize: '9px' }}>↑ Upload: {formatBytes(bucket.uploadBytes)}</span>
        </div>
      )}
      {bucket.total > 0 && (
        <div
          style={{
            marginTop: '2px',
            paddingTop: '2px',
            borderTop: '1px solid #555',
            fontSize: '9px',
          }}
        >
          Total: {formatBytes(bucket.total)}
        </div>
      )}
    </>
  );
}
