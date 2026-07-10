import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AnonMappingDialog } from '../AnonMappingDialog';
import { useLogStore } from '../../stores/logStore';
import { createParsedLogLine } from '../../test/fixtures';
import type { AnonymizationDictionary } from '../../types/log.types';

const dict: AnonymizationDictionary = {
  forward: {
    '@alice:matrix.org': '@user-aaaaaaaaaaaa:domain-11111111.org',
    '@bob:example.org': '@user-bbbbbbbbbbbb:domain-22222222.org',
    'matrix.org': 'domain-11111111.org',
  },
  reverse: {
    '@user-aaaaaaaaaaaa:domain-11111111.org': '@alice:matrix.org',
    '@user-bbbbbbbbbbbb:domain-22222222.org': '@bob:example.org',
    'domain-11111111.org': 'matrix.org',
  },
};

function getRows() {
  // Each mapping row contains the "→" arrow.
  return screen.getAllByText('→').map((el) => el.parentElement as HTMLElement);
}

describe('AnonMappingDialog', () => {
  beforeEach(() => {
    useLogStore.getState().clearData();
  });

  it('renders one row per forward entry with original and alias', () => {
    render(<AnonMappingDialog dict={dict} onClose={vi.fn()} />);
    const rows = getRows();
    expect(rows).toHaveLength(3);
    expect(screen.getByText('3 entries')).toBeInTheDocument();

    const aliceRow = rows.find((r) => within(r).queryByText('@alice:matrix.org'))!;
    expect(within(aliceRow).getByText('@user-aaaaaaaaaaaa:domain-11111111.org')).toBeInTheDocument();
  });

  it('filters rows by original identifier', () => {
    render(<AnonMappingDialog dict={dict} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'alice' } });
    expect(getRows()).toHaveLength(1);
    expect(screen.getByText('@alice:matrix.org')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 3')).toBeInTheDocument();
  });

  it('filters rows by alias too', () => {
    render(<AnonMappingDialog dict={dict} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bbbbbbbbbbbb' } });
    expect(getRows()).toHaveLength(1);
    expect(screen.getByText('@bob:example.org')).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', () => {
    render(<AnonMappingDialog dict={dict} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'zzzzz' } });
    expect(screen.getByText('No matching entries')).toBeInTheDocument();
    expect(screen.getByText('Showing 0 of 3')).toBeInTheDocument();
  });

  it('builds a preview mapping from the current logs when none is applied (null dict)', async () => {
    useLogStore.setState({
      rawLogLines: [createParsedLogLine({ lineNumber: 0, rawText: '@alice:matrix.org joined' })],
    });
    render(<AnonMappingDialog dict={null} onClose={vi.fn()} />);

    // The original id shows once the async preview build completes.
    expect(await screen.findByText('@alice:matrix.org')).toBeInTheDocument();
    expect(screen.getByText(/preview/i)).toBeInTheDocument();
    // Its alias follows the hashed format.
    const row = getRows().find((r) => within(r).queryByText('@alice:matrix.org'))!;
    expect(within(row).getByText(/^@user-[0-9a-f]{12}:domain-[0-9a-f]{8}\.org$/)).toBeInTheDocument();
  });

  it('uses buildPreview when provided (archive/listing context)', async () => {
    const previewDict = {
      forward: { '@carol:matrix.org': '@user-cccccccccccc:domain-33333333.org' },
      reverse: { '@user-cccccccccccc:domain-33333333.org': '@carol:matrix.org' },
    };
    render(<AnonMappingDialog dict={null} buildPreview={() => Promise.resolve(previewDict)} onClose={vi.fn()} />);
    expect(await screen.findByText('@carol:matrix.org')).toBeInTheDocument();
    expect(screen.getByText(/preview/i)).toBeInTheDocument();
  });

  it('shows an error when the preview build fails', async () => {
    render(<AnonMappingDialog dict={null} buildPreview={() => Promise.reject(new Error('nope'))} onClose={vi.fn()} />);
    expect(await screen.findByText(/could not build the mapping/i)).toBeInTheDocument();
  });

  it('shows "no identifiers" preview state when the logs have none (null dict)', async () => {
    useLogStore.setState({
      rawLogLines: [createParsedLogLine({ lineNumber: 0, rawText: 'nothing to anonymise here' })],
    });
    render(<AnonMappingDialog dict={null} onClose={vi.fn()} />);
    expect(await screen.findByText(/no matrix identifiers found/i)).toBeInTheDocument();
  });

  it('close button fires onClose', () => {
    const onClose = vi.fn();
    render(<AnonMappingDialog dict={dict} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close anonymisation mapping dialog/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('previews the loaded log by default when no dict or builder is given', async () => {
    useLogStore.setState({
      rawLogLines: [createParsedLogLine({ lineNumber: 0, rawText: '@dave:matrix.org joined' })],
    });
    render(<AnonMappingDialog dict={null} onClose={vi.fn()} />);
    expect(await screen.findByText('@dave:matrix.org')).toBeInTheDocument();
  });

  it('closes on backdrop click but not on clicks inside the panel', () => {
    const onClose = vi.fn();
    render(<AnonMappingDialog dict={dict} onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape when no central shortcut handler is present', () => {
    const onClose = vi.fn();
    render(<AnonMappingDialog dict={dict} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus within the dialog', () => {
    render(<AnonMappingDialog dict={dict} onClose={vi.fn()} />);
    const panel = screen.getByRole('dialog');
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first.focus();
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    last.focus();
    fireEvent.keyDown(panel, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });
});
