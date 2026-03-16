import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimelineScaleSelector } from '../TimelineScaleSelector';

const mockSetScale = vi.fn();

vi.mock('../../hooks/useURLParams', () => ({
  useURLParams: () => ({
    setScale: mockSetScale,
    setTimeFilter: vi.fn(),
    setStatusFilter: vi.fn(),
    setLogFilter: vi.fn(),
  }),
}));

describe('TimelineScaleSelector', () => {
  beforeEach(() => {
    mockSetScale.mockReset();
  });

  describe('rendering', () => {
    it('renders the selector button', () => {
      const { container } = render(<TimelineScaleSelector msPerPixel={10} />);
      expect(container.querySelector('button')).toBeInTheDocument();
    });

    it('displays current scale label for known option', () => {
      render(<TimelineScaleSelector msPerPixel={10} />);
      expect(screen.getByTitle('Timeline scale')).toHaveTextContent('1px = 10ms');
    });

    it('displays custom label for unknown ms per pixel value', () => {
      render(<TimelineScaleSelector msPerPixel={75} />);
      expect(screen.getByTitle('Timeline scale')).toHaveTextContent('1px = 75ms');
    });

    it('shows correct label for each known scale option', () => {
      const { container } = render(<TimelineScaleSelector msPerPixel={5} />);
      const btn = container.querySelector('button');
      expect(btn).toHaveTextContent('1px = 5ms');
    });

    it('shows correct label for 1000ms option', () => {
      const { container } = render(<TimelineScaleSelector msPerPixel={1000} />);
      const btn = container.querySelector('button');
      expect(btn).toHaveTextContent('1px = 1000ms');
    });
  });

  describe('dropdown interaction', () => {
    it('dropdown is not visible initially', () => {
      render(<TimelineScaleSelector msPerPixel={10} />);
      expect(screen.queryByText('1px = 5ms')).not.toBeInTheDocument();
    });

    it('opens dropdown when button is clicked', () => {
      render(<TimelineScaleSelector msPerPixel={10} />);
      fireEvent.click(screen.getByTitle('Timeline scale'));
      // All scale options should be visible in the dropdown
      expect(screen.getByText('1px = 5ms')).toBeInTheDocument();
      expect(screen.getByText('1px = 25ms')).toBeInTheDocument();
      expect(screen.getByText('1px = 1000ms')).toBeInTheDocument();
    });

    it('sets aria-expanded to false initially', () => {
      render(<TimelineScaleSelector msPerPixel={10} />);
      const button = screen.getByTitle('Timeline scale');
      expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('sets aria-expanded to true when open', () => {
      render(<TimelineScaleSelector msPerPixel={10} />);
      fireEvent.click(screen.getByTitle('Timeline scale'));
      expect(screen.getByTitle('Timeline scale')).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes dropdown when button is clicked again', () => {
      render(<TimelineScaleSelector msPerPixel={10} />);
      fireEvent.click(screen.getByTitle('Timeline scale'));
      fireEvent.click(screen.getByTitle('Timeline scale'));
      expect(screen.queryByText('1px = 5ms')).not.toBeInTheDocument();
    });

    it('calls setScale when an option is selected', () => {
      render(<TimelineScaleSelector msPerPixel={10} />);
      fireEvent.click(screen.getByTitle('Timeline scale'));
      // Click the 50ms option
      fireEvent.click(screen.getByText('1px = 50ms'));
      expect(mockSetScale).toHaveBeenCalledWith(50);
    });

    it('closes dropdown after selecting an option', () => {
      render(<TimelineScaleSelector msPerPixel={10} />);
      fireEvent.click(screen.getByTitle('Timeline scale'));
      fireEvent.click(screen.getByText('1px = 50ms'));
      expect(screen.queryByText('1px = 5ms')).not.toBeInTheDocument();
    });

    it('calls setScale with value 5', () => {
      render(<TimelineScaleSelector msPerPixel={50} />);
      fireEvent.click(screen.getByTitle('Timeline scale'));
      fireEvent.click(screen.getByText('1px = 5ms'));
      expect(mockSetScale).toHaveBeenCalledWith(5);
    });

    it('calls setScale with value 1000', () => {
      render(<TimelineScaleSelector msPerPixel={50} />);
      fireEvent.click(screen.getByTitle('Timeline scale'));
      fireEvent.click(screen.getByText('1px = 1000ms'));
      expect(mockSetScale).toHaveBeenCalledWith(1000);
    });

    it('closes dropdown when clicking outside', () => {
      const { container } = render(
        <div>
          <TimelineScaleSelector msPerPixel={10} />
          <div data-testid="outside">outside</div>
        </div>
      );
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('1px = 5ms')).toBeInTheDocument();

      // Click outside
      fireEvent.mouseDown(screen.getByTestId('outside'));
      expect(screen.queryByText('1px = 5ms')).not.toBeInTheDocument();
    });
  });

  describe('active state', () => {
    it('renders all options including current scale', () => {
      render(<TimelineScaleSelector msPerPixel={100} />);
      fireEvent.click(screen.getByTitle('Timeline scale'));
      const buttons = screen.getAllByRole('button');
      // The option matching msPerPixel=100 should exist
      const option100 = buttons.find(b => b.textContent === '1px = 100ms');
      expect(option100).toBeDefined();
    });
  });
});
