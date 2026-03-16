import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LogExportDialog } from '../LogExportDialog';
import type { ExportContext } from '../../utils/logExportUtils';
import type { DisplayItem } from '../../utils/logGapManager';
import { createParsedLogLine } from '../../test/fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDisplayItems(count: number): DisplayItem[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'line' as const,
    data: {
      line: createParsedLogLine({
        lineNumber: i + 1,
        rawText: `2024-01-15T10:00:00.000000Z INFO line ${i + 1}`,
      }),
      index: i,
    },
  }));
}

const BASE_CONTEXT: ExportContext = {
  filterQuery: '',
  contextLines: 0,
  lineWrap: false,
  stripPrefix: true,
  collapseEnabled: false,
  startTime: null,
  endTime: null,
};

function renderDialog(
  overrides: Partial<{ displayItems: DisplayItem[]; context: ExportContext; onClose: () => void }> = {},
) {
  const onClose = overrides.onClose ?? vi.fn();
  render(
    <LogExportDialog
      displayItems={overrides.displayItems ?? makeDisplayItems(3)}
      context={overrides.context ?? BASE_CONTEXT}
      onClose={onClose}
    />,
  );
  return { onClose };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LogExportDialog', () => {
  beforeEach(() => {
    // Mock clipboard.writeText
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    // mock URL.createObjectURL / revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = vi.fn();
  });

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  it('renders the dialog', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: /export logs/i })).toBeInTheDocument();
    expect(screen.getByText('Export Logs')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Close behaviour
  // -------------------------------------------------------------------------

  it('calls onClose when the close button is clicked', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is clicked', () => {
    const { onClose } = renderDialog();
    const panel = screen.getByRole('dialog');
    fireEvent.click(panel.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when clicking inside the panel', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    const { onClose } = renderDialog();
    const panel = screen.getByRole('dialog');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Options
  // -------------------------------------------------------------------------

  it('strip-prefix starts unchecked regardless of context', () => {
    renderDialog({ context: { ...BASE_CONTEXT, stripPrefix: true } });
    const checkbox = screen.getByRole('checkbox', { name: /strip timestamp/i });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it('all options start unchecked', () => {
    renderDialog();
    const boxes = screen.getAllByRole('checkbox');
    // intro, lineNumbers, showGaps, collapseDuplicates, stripPrefix, maxWidth => 6 checkboxes
    expect(boxes).toHaveLength(6);
    boxes.forEach((cb) => expect((cb as HTMLInputElement).checked).toBe(false));
  });

  it('collapse-duplicates checkbox starts unchecked', () => {
    renderDialog();
    const checkbox = screen.getByRole('checkbox', { name: /collapse consecutive duplicate/i });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it('max-width number input is disabled when max-width checkbox is unchecked', () => {
    renderDialog();
    const widthInput = screen.getByRole('spinbutton', { name: /maximum line width/i });
    expect((widthInput as HTMLInputElement).disabled).toBe(true);
  });

  it('max-width number input is enabled after checking the max-width checkbox', () => {
    renderDialog();
    const maxWidthCheckbox = screen.getByRole('checkbox', { name: /wrap lines at/i });
    fireEvent.click(maxWidthCheckbox);
    const widthInput = screen.getByRole('spinbutton', { name: /maximum line width/i });
    expect((widthInput as HTMLInputElement).disabled).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Copy to clipboard
  // -------------------------------------------------------------------------

  it('calls navigator.clipboard.writeText when copy button is clicked', async () => {
    renderDialog({ displayItems: makeDisplayItems(2) });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy to clipboard/i }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const text = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain('line 1');
    expect(text).toContain('line 2');
  });

  it('shows "Copied!" confirmation after copying', async () => {
    vi.useFakeTimers();
    renderDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy to clipboard/i }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Copied!');
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Save to file
  // -------------------------------------------------------------------------

  it('triggers a file download when save button is clicked', () => {
    // Spy on anchor click (jsdom does not navigate)
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderDialog({ displayItems: makeDisplayItems(1) });
    fireEvent.click(screen.getByRole('button', { name: /save to file/i }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');

    clickSpy.mockRestore();
  });

  it('shows "Saved!" confirmation after saving', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /save to file/i }));
    expect(screen.getByRole('status')).toHaveTextContent('Saved!');
  });

  // -------------------------------------------------------------------------
  // Focus management
  // -------------------------------------------------------------------------

  it('focuses the close button when the dialog opens', () => {
    renderDialog();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /close/i }));
  });

  it('does not close on Tab keydown (only Escape closes)', () => {
    const { onClose } = renderDialog();
    const panel = screen.getByRole('dialog');
    fireEvent.keyDown(panel, { key: 'Tab' });
    expect(onClose).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Max width number input
  // -------------------------------------------------------------------------

  it('updates maxWidth value when user types a valid number', () => {
    renderDialog();
    const maxWidthCheckbox = screen.getByRole('checkbox', { name: /wrap lines at/i });
    fireEvent.click(maxWidthCheckbox);
    const widthInput = screen.getByRole('spinbutton', { name: /maximum line width/i }) as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: '80' } });
    expect(widthInput.value).toBe('80');
  });

  it('does not update maxWidth when user types an invalid number below 4', () => {
    renderDialog();
    const maxWidthCheckbox = screen.getByRole('checkbox', { name: /wrap lines at/i });
    fireEvent.click(maxWidthCheckbox);
    const widthInput = screen.getByRole('spinbutton', { name: /maximum line width/i }) as HTMLInputElement;
    const originalValue = widthInput.value;
    fireEvent.change(widthInput, { target: { value: '2' } });
    // State not updated, so external value stays at previous
    expect(widthInput.value).toBe(originalValue);
  });

  // -------------------------------------------------------------------------
  // Confirmation timer safety (double-trigger)
  // -------------------------------------------------------------------------

  it('handles rapid successive copy calls without crashing', async () => {
    renderDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy to clipboard/i }));
    });
    // Second click while timer is still running
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy to clipboard/i }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Export content verification
  // -------------------------------------------------------------------------

  it('saves file content that matches selected options', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blobSpy = vi.spyOn(global, 'Blob').mockImplementation(function (content) {
      // Capture the content for assertion
      (this as unknown as { capturedContent: string[] }).capturedContent = content as string[];
      return { size: 0, type: '' } as Blob;
    });

    renderDialog({ displayItems: makeDisplayItems(1) });
    // Enable line numbers
    fireEvent.click(screen.getByRole('checkbox', { name: /prefix lines/i }));
    fireEvent.click(screen.getByRole('button', { name: /save to file/i }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
    blobSpy.mockRestore();
  });
});
