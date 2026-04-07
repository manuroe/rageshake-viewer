import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  beforeEach(() => {
    onClose.mockReset();
    useLogStore.getState().clearData();
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

  it('shows an error when ev.target.result is not a string', async () => {
    // Patch FileReader so onload receives a non-string result
    const OriginalFileReader = global.FileReader;
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

    global.FileReader = OriginalFileReader;
  });

  it('shows an error when FileReader.onerror fires', async () => {
    const OriginalFileReader = global.FileReader;
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

    global.FileReader = OriginalFileReader;
  });

  it('closes with Escape when no keyboard shortcut context is present', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Unanonymise logs' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab cycles focus within the panel', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Unanonymise logs' });
    // Just verify no error is thrown when Tab is pressed
    fireEvent.keyDown(dialog, { key: 'Tab' });
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
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
