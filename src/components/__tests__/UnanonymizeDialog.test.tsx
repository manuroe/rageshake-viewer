import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { UnanonymizeDialog } from '../UnanonymizeDialog';
import { useLogStore } from '../../stores/logStore';
import { createParsedLogLine } from '../../test/fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const onClose = vi.fn();

function renderDialog() {
  return render(<UnanonymizeDialog onClose={onClose} />);
}

function makeDictJson(forward: Record<string, string>, reverse: Record<string, string>): File {
  const content = JSON.stringify({ forward, reverse });
  return new File([content], 'dictionary.json', { type: 'application/json' });
}

async function loadFile(file: File) {
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    fireEvent.change(fileInput, { target: { files: [file] } });
    await new Promise((res) => setTimeout(res, 0));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UnanonymizeDialog', () => {
  const OriginalFileReader = global.FileReader;

  beforeEach(() => {
    onClose.mockReset();
    useLogStore.getState().clearData();
  });

  afterEach(() => {
    global.FileReader = OriginalFileReader;
  });

  it('renders the dialog with title and close button', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Unanonymise logs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close unanonymise/i })).toBeInTheDocument();
  });

  it('closes when the close button is clicked', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /close unanonymise/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when clicking the backdrop', () => {
    render(<UnanonymizeDialog onClose={onClose} />);
    const backdrop = document.querySelector<HTMLElement>('[role="dialog"]')?.parentElement;
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the panel', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Unanonymise logs' });
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Apply button is disabled until a valid file is loaded', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /apply and unanonymise/i })).toBeDisabled();
  });

  it('shows file name and entry count after a valid JSON dictionary is chosen', async () => {
    renderDialog();
    const file = makeDictJson(
      { '@alice:example.org': '@user0:domain0.org' },
      { '@user0:domain0.org': '@alice:example.org' },
    );
    await loadFile(file);

    expect(screen.getAllByText('dictionary.json').length).toBeGreaterThanOrEqual(1);
    // The selected-file span is distinct from the body-text <code> element
    expect(screen.getByText(/1 entries/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /apply and unanonymise/i })).not.toBeDisabled();
  });

  it('shows an error for invalid JSON', async () => {
    renderDialog();
    const file = new File(['not valid json{'], 'bad.json', { type: 'application/json' });
    await loadFile(file);
    expect(screen.getByText(/not valid json/i)).toBeInTheDocument();
  });

  it('shows an error for a JSON file that does not match the expected shape', async () => {
    renderDialog();
    const file = new File([JSON.stringify([1, 2, 3])], 'wrong.json', { type: 'application/json' });
    await loadFile(file);
    expect(screen.getByText(/invalid dictionary/i)).toBeInTheDocument();
  });

  it('shows an error when forward/reverse contain non-string values', async () => {
    renderDialog();
    const bad = JSON.stringify({ forward: { key: 123 }, reverse: {} });
    const file = new File([bad], 'bad.json', { type: 'application/json' });
    await loadFile(file);
    expect(screen.getByText(/invalid dictionary/i)).toBeInTheDocument();
  });

  it('shows an error when forward is an array', async () => {
    renderDialog();
    const bad = JSON.stringify({ forward: ['oops'], reverse: {} });
    const file = new File([bad], 'bad.json', { type: 'application/json' });
    await loadFile(file);
    expect(screen.getByText(/invalid dictionary/i)).toBeInTheDocument();
  });

  it('shows an error when ev.target.result is not a string', async () => {
    // Patch FileReader so onload receives a non-string result
    class FakeFileReader extends EventTarget {
      result: string | null = null;
      onload: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      readAsText() {
        // Simulate async load with null (non-string) result
        setTimeout(() => {
          if (this.onload) {
            // @ts-expect-error -- intentionally malformed for test
            this.onload({ target: { result: null } });
          }
        }, 0);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.FileReader = FakeFileReader as any;

    renderDialog();
    const file = new File(['ignored'], 'dict.json', { type: 'application/json' });
    await loadFile(file);
    expect(screen.getByText(/could not read file/i)).toBeInTheDocument();
  });

  it('shows an error when FileReader.onerror fires', async () => {
    class FakeFileReader extends EventTarget {
      result: string | null = null;
      onload: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      readAsText() {
        setTimeout(() => {
          if (this.onerror) {
            // @ts-expect-error -- intentionally malformed for test
            this.onerror({});
          }
        }, 0);
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.FileReader = FakeFileReader as any;

    renderDialog();
    const file = new File(['ignored'], 'dict.json', { type: 'application/json' });
    await loadFile(file);
    expect(screen.getByText(/failed to read file/i)).toBeInTheDocument();
  });

  it('closes with Escape when no keyboard shortcut context is present', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Unanonymise logs' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab cycles focus within the panel (Shift+Tab path)', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Unanonymise logs' });
    // Use the same selector as the component so we get the true first focusable element
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    // Focus the first element so Shift+Tab triggers the wrap-to-last branch
    focusable[0].focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);
  });

  it('Tab key wraps forward from last focusable element back to first', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Unanonymise logs' });
    // Use the same selector as the component so we get the true last focusable element
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    // Focus the last element so Tab triggers the wrap-to-first branch
    focusable[focusable.length - 1].focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(focusable[0]);
  });

  it('Shift+Tab does not wrap when focus is not on the first element', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Unanonymise logs' });
    // Focus the second button (not the first); Shift+Tab should not wrap
    const buttons = screen.getAllByRole('button');
    buttons[1].focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    // Focus stays on the second button (no wrap)
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('Tab does not wrap when focus is not on the last element', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Unanonymise logs' });
    // Focus the first button; Tab should not wrap
    const buttons = screen.getAllByRole('button');
    buttons[0].focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    // Focus stays on the first button (no wrap to beginning)
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('clicking "Choose dictionary file…" triggers the file input', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /choose dictionary file/i }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('calls unanonymizeLogs and onClose when Apply is clicked after loading a valid dict', async () => {
    const anonymizedLine = createParsedLogLine({
      lineNumber: 0,
      rawText: '2024-01-15T10:00:00.000000Z INFO @user0:domain0.org joined',
      message: '2024-01-15T10:00:00.000000Z INFO @user0:domain0.org joined',
      strippedMessage: '@user0:domain0.org joined',
    });
    useLogStore.getState().loadLogParserResult({
      requests: [],
      connectionIds: [],
      rawLogLines: [anonymizedLine],
      httpRequests: [],
      sentryEvents: [],
      isAnonymized: true,
    });

    renderDialog();

    const forward = { '@alice:example.org': '@user0:domain0.org' };
    const reverse = { '@user0:domain0.org': '@alice:example.org' };
    await loadFile(makeDictJson(forward, reverse));

    await waitFor(() => expect(screen.getByRole('button', { name: /apply/i })).not.toBeDisabled());

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /apply/i }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useLogStore.getState().isAnonymized).toBe(false);
    expect(useLogStore.getState().rawLogLines[0].rawText).toContain('@alice:example.org');
  });
});
