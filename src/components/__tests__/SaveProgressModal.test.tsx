import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SaveProgressModal } from '../SaveProgressModal';

describe('SaveProgressModal', () => {
  it('shows a determinate bar and count when total > 0', () => {
    render(<SaveProgressModal phase="Fetching files" current={3} total={12} onDismiss={vi.fn()} />);
    expect(screen.getByText('Fetching files 3/12')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '25');
  });

  it('shows an indeterminate label (no bar) when total is 0', () => {
    render(<SaveProgressModal phase="Anonymising archive" current={0} total={0} onDismiss={vi.fn()} />);
    expect(screen.getByText('Anonymising archive…')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows an error with a Close button and no progress bar', () => {
    const onDismiss = vi.fn();
    render(<SaveProgressModal phase="" current={0} total={0} error="boom" onDismiss={onDismiss} />);
    expect(screen.getByText('Save failed')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
