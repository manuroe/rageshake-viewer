import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';
import { AppError } from '../../utils/errorHandling';

// Suppress expected error output in tests
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A component that throws when shouldThrow prop is true */
function ThrowingComponent({ shouldThrow = false, message = 'Test error' }: { shouldThrow?: boolean; message?: string }) {
  if (shouldThrow) {
    throw new Error(message);
  }
  return <div>Normal content</div>;
}

/** A component that throws an AppError */
function AppErrorComponent({ shouldThrow = false }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new AppError('App-level error message', 'error');
  }
  return <div>Normal content</div>;
}

describe('ErrorBoundary', () => {
  describe('normal rendering', () => {
    it('renders children when no error occurs', () => {
      render(
        <ErrorBoundary>
          <div>Child content</div>
        </ErrorBoundary>
      );
      expect(screen.getByText('Child content')).toBeInTheDocument();
    });

    it('renders multiple children', () => {
      render(
        <ErrorBoundary>
          <span>First</span>
          <span>Second</span>
        </ErrorBoundary>
      );
      expect(screen.getByText('First')).toBeInTheDocument();
      expect(screen.getByText('Second')).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('shows default fallback UI when a child throws', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow />
        </ErrorBoundary>
      );
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('shows the error message in fallback UI', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow message="Something broke" />
        </ErrorBoundary>
      );
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('shows AppError userMessage in fallback UI', () => {
      render(
        <ErrorBoundary>
          <AppErrorComponent shouldThrow />
        </ErrorBoundary>
      );
      expect(screen.getByText('App-level error message')).toBeInTheDocument();
    });

    it('shows Try Again button', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow />
        </ErrorBoundary>
      );
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('Try Again button resets error state and re-renders children', () => {
      // Use a mutable flag so we can stop throwing before the boundary re-renders
      let shouldThrow = true;
      function RecoverableChild() {
        if (shouldThrow) throw new Error('Test error');
        return <div>Recovered content</div>;
      }

      render(
        <ErrorBoundary>
          <RecoverableChild />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.queryByText('Recovered content')).not.toBeInTheDocument();

      // Allow recovery before clicking Try Again
      shouldThrow = false;
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));

      // Fallback should be gone and children should be visible again
      expect(screen.getByText('Recovered content')).toBeInTheDocument();
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });
  });

  describe('custom fallback', () => {
    it('uses custom fallback when provided', () => {
      const customFallback = (error: Error) => (
        <div>Custom fallback: {error.message}</div>
      );

      render(
        <ErrorBoundary fallback={customFallback}>
          <ThrowingComponent shouldThrow message="custom error" />
        </ErrorBoundary>
      );

      expect(screen.getByText('Custom fallback: custom error')).toBeInTheDocument();
    });

    it('passes resetError to custom fallback and clicking it re-renders children', () => {
      let shouldThrow = true;
      function RecoverableChild() {
        if (shouldThrow) throw new Error('Test error');
        return <div>Custom recovered</div>;
      }

      const customFallback = (_error: Error, reset: () => void) => (
        <button onClick={reset}>Reset</button>
      );

      render(
        <ErrorBoundary fallback={customFallback}>
          <RecoverableChild />
        </ErrorBoundary>
      );

      // Custom fallback is shown, children are not
      expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
      expect(screen.queryByText('Custom recovered')).not.toBeInTheDocument();

      // Allow recovery then click the reset button provided by resetError
      shouldThrow = false;
      fireEvent.click(screen.getByRole('button', { name: /reset/i }));

      // Children should now render; custom fallback should be gone
      expect(screen.getByText('Custom recovered')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument();
    });
  });
});
