import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LogSelectionDialog } from '../LogSelectionDialog';
import { KeyboardShortcutContext } from '../KeyboardShortcutContext';
import { useArchiveStore } from '../../stores/archiveStore';
import { useListingStore } from '../../stores/listingStore';
import { useLogStore } from '../../stores/logStore';

const { mockOpenMergedEntries } = vi.hoisted(() => ({ mockOpenMergedEntries: vi.fn() }));
vi.mock('../../utils/openMergedLogs', () => ({ openMergedEntries: mockOpenMergedEntries }));

const onClose = vi.fn();

function loadArchive(names: string[]) {
  const data = new TextEncoder().encode('x');
  useArchiveStore.getState().loadArchive('test.tar.gz', names.map((name) => ({ name, data })));
}

describe('LogSelectionDialog', () => {
  beforeEach(() => {
    onClose.mockReset();
    mockOpenMergedEntries.mockReset().mockResolvedValue('/summary');
    useArchiveStore.getState().clearArchive();
    useListingStore.getState().clearListing();
    useLogStore.getState().clearData();
  });

  it('lists analyzable archive entries with the loaded ones pre-checked', () => {
    loadArchive(['logs.2026-04-14-08.log.gz', 'logs.2026-04-14-09.log.gz', 'details.json']);
    useLogStore.setState({ loadedEntryNames: ['logs.2026-04-14-08.log.gz'] });

    render(<MemoryRouter><LogSelectionDialog onClose={onClose} /></MemoryRouter>);

    // details.json is not analyzable → excluded
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    // only the currently-loaded file (08) is pre-checked
    const cb08 = screen.getByRole('checkbox', { name: /logs\.2026-04-14-08/i }) as HTMLInputElement;
    const cb09 = screen.getByRole('checkbox', { name: /logs\.2026-04-14-09/i }) as HTMLInputElement;
    expect(cb08.checked).toBe(true);
    expect(cb09.checked).toBe(false);
  });

  it('toggles a checkbox and applies the new selection', async () => {
    loadArchive(['logs.2026-04-14-08.log.gz', 'logs.2026-04-14-09.log.gz']);
    useLogStore.setState({ loadedEntryNames: ['logs.2026-04-14-08.log.gz'] });

    render(<MemoryRouter><LogSelectionDialog onClose={onClose} /></MemoryRouter>);

    // Tick the second (currently unchecked) file
    const unchecked = screen.getAllByRole('checkbox').find((c) => !(c as HTMLInputElement).checked)!;
    fireEvent.click(unchecked);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /display 2 selected/i }));
    });

    expect(mockOpenMergedEntries).toHaveBeenCalledTimes(1);
    expect(mockOpenMergedEntries.mock.calls[0][0]).toEqual(
      expect.arrayContaining(['logs.2026-04-14-08.log.gz', 'logs.2026-04-14-09.log.gz'])
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('disables the apply button when nothing is selected', () => {
    loadArchive(['logs.2026-04-14-08.log.gz']);
    useLogStore.setState({ loadedEntryNames: [] });

    render(<MemoryRouter><LogSelectionDialog onClose={onClose} /></MemoryRouter>);

    expect(screen.getByRole('button', { name: /display 0 selected/i })).toBeDisabled();
  });

  it('keeps the dialog open when opening yields no route', async () => {
    loadArchive(['logs.2026-04-14-08.log.gz']);
    useLogStore.setState({ loadedEntryNames: ['logs.2026-04-14-08.log.gz'] });
    mockOpenMergedEntries.mockResolvedValue(null);
    render(<MemoryRouter><LogSelectionDialog onClose={onClose} /></MemoryRouter>);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /display 1 selected/i }));
    });

    expect(mockOpenMergedEntries).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('defers Escape to the central shortcut context when present', () => {
    loadArchive(['logs.2026-04-14-08.log.gz']);
    const registerDismiss = vi.fn(() => vi.fn());
    const ctx = {
      showHelp: false,
      toggleHelp: vi.fn(),
      pendingChord: null,
      registerFocusSearch: vi.fn(() => vi.fn()),
      registerFocusFilter: vi.fn(() => vi.fn()),
      registerDismiss,
    };
    render(
      <MemoryRouter>
        <KeyboardShortcutContext.Provider value={ctx}>
          <LogSelectionDialog onClose={onClose} />
        </KeyboardShortcutContext.Provider>
      </MemoryRouter>
    );

    expect(registerDismiss).toHaveBeenCalledWith(onClose);
    // Central context owns Escape → the local fallback must not also close.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    loadArchive(['logs.2026-04-14-08.log.gz']);
    render(<MemoryRouter><LogSelectionDialog onClose={onClose} /></MemoryRouter>);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus inside the dialog', () => {
    loadArchive(['logs.2026-04-14-08.log.gz']);
    useLogStore.setState({ loadedEntryNames: ['logs.2026-04-14-08.log.gz'] }); // enables Apply button
    render(<MemoryRouter><LogSelectionDialog onClose={onClose} /></MemoryRouter>);
    const dialog = screen.getByRole('dialog');
    // Mirror the component's focus selector (disabled controls excluded).
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes via the close button and the backdrop', () => {
    loadArchive(['logs.2026-04-14-08.log.gz']);
    render(<MemoryRouter><LogSelectionDialog onClose={onClose} /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: /close log selection/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
