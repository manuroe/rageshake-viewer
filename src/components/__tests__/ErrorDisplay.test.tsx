import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorDisplay from '../ErrorDisplay';
import type { AppError } from '../../utils/errorHandling';

function makeError(overrides: Partial<AppError> = {}): AppError {
  return {
    severity: 'error',
    userMessage: 'Something went wrong',
    technicalMessage: 'Technical detail',
    ...overrides,
  };
}

describe('ErrorDisplay', () => {
  it('renders nothing when error is null', () => {
    const { container } = render(<ErrorDisplay error={null} />);
    expect(container.firstChild).toBeNull();
  });

  describe('severity: error', () => {
    it('renders the user message', () => {
      render(<ErrorDisplay error={makeError({ userMessage: 'File too large' })} />);
      expect(screen.getByText('File too large')).toBeInTheDocument();
    });

    it('uses role="alert" for errors', () => {
      const { container } = render(<ErrorDisplay error={makeError()} />);
      expect(container.querySelector('[role="alert"]')).toBeInTheDocument();
    });

    it('does NOT set aria-live for errors (only warnings use it)', () => {
      const { container } = render(<ErrorDisplay error={makeError()} />);
      const div = container.querySelector('[role="alert"]');
      expect(div?.getAttribute('aria-live')).toBeNull();
    });

    it('uses error color (#ef4444)', () => {
      const { container } = render(<ErrorDisplay error={makeError()} />);
      const div = container.firstChild as HTMLElement;
      expect(div.style.color).toBe('rgb(239, 68, 68)');
    });
  });

  describe('severity: warning', () => {
    it('renders the warning message', () => {
      render(
        <ErrorDisplay error={makeError({ severity: 'warning', userMessage: 'Low disk space' })} />,
      );
      expect(screen.getByText('Low disk space')).toBeInTheDocument();
    });

    it('does not use role="alert" for warnings', () => {
      const { container } = render(
        <ErrorDisplay error={makeError({ severity: 'warning' })} />,
      );
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it('uses aria-live="polite" for warnings', () => {
      const { container } = render(
        <ErrorDisplay error={makeError({ severity: 'warning' })} />,
      );
      const div = container.firstChild as HTMLElement;
      expect(div.getAttribute('aria-live')).toBe('polite');
    });

    it('uses warning color (#f59e0b)', () => {
      const { container } = render(
        <ErrorDisplay error={makeError({ severity: 'warning' })} />,
      );
      const div = container.firstChild as HTMLElement;
      expect(div.style.color).toBe('rgb(245, 158, 11)');
    });
  });

  describe('onDismiss', () => {
    it('renders dismiss button when onDismiss is provided', () => {
      render(<ErrorDisplay error={makeError()} onDismiss={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });

    it('does not render dismiss button when onDismiss is absent', () => {
      render(<ErrorDisplay error={makeError()} />);
      expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    });

    it('calls onDismiss when dismiss button is clicked', () => {
      const onDismiss = vi.fn();
      render(<ErrorDisplay error={makeError()} onDismiss={onDismiss} />);
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('className prop', () => {
    it('applies custom className to the container', () => {
      const { container } = render(<ErrorDisplay error={makeError()} className="my-error" />);
      expect(container.firstChild).toHaveClass('my-error');
    });
  });
});
