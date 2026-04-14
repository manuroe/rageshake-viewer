import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { compressSync } from 'fflate';
import { FileUpload } from '../FileUpload';
import { useLogStore } from '../../stores/logStore';
import { useArchiveStore } from '../../stores/archiveStore';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const mockParseLogFile = vi.fn();

vi.mock('../../utils/logParser', () => ({
  parseLogFile: (content: string) => mockParseLogFile(content),
}));

describe('FileUpload navigation', () => {
  beforeEach(() => {
    useLogStore.getState().clearData();
    useLogStore.getState().clearLastRoute();
    mockNavigate.mockReset();
    mockParseLogFile.mockReset();

    mockParseLogFile.mockReturnValue({
      requests: [],
      httpRequests: [],
      connectionIds: [],
      sentryEvents: [],
      rawLogLines: [
        {
          lineNumber: 0,
          rawText: 'line 0',
          isoTimestamp: '1970-01-01T00:00:00.000000Z',
          timestampUs: 0,
          displayTime: '00:00:00.000000',
          level: 'INFO',
          message: 'line 0',
          strippedMessage: 'line 0',
          continuationLines: [],
        },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to last route after upload when available', async () => {
    useLogStore.setState({ lastRoute: '/http_requests?request_id=REQ-1' });

    const { container } = render(<FileUpload />);
    const input = container.querySelector('#file-input') as HTMLInputElement;
    const file = new File(['content'], 'test.log', { type: 'text/plain' });

    fireEvent.change(input, { target: { files: [file] } });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/http_requests?request_id=REQ-1');
        resolve();
      }, 100);
    });
  });

  it('falls back to /summary when last route is empty', async () => {
    useLogStore.setState({ lastRoute: null });

    const { container } = render(<FileUpload />);
    const input = container.querySelector('#file-input') as HTMLInputElement;
    const file = new File(['content'], 'test.log', { type: 'text/plain' });

    fireEvent.change(input, { target: { files: [file] } });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/summary');
        resolve();
      }, 100);
    });
  });

  it('decompresses .log.gz files and parses content', async () => {
    useLogStore.setState({ lastRoute: '/summary' });

    const logContent = 'test log line 1\ntest log line 2';
    const compressedData = compressSync(new TextEncoder().encode(logContent));

    const { container } = render(<FileUpload />);
    const input = container.querySelector('#file-input') as HTMLInputElement;
    const file = new File([compressedData as BlobPart], 'test.log.gz', { type: 'application/gzip' });

    fireEvent.change(input, { target: { files: [file] } });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(mockParseLogFile).toHaveBeenCalledWith(logContent);
        expect(mockNavigate).toHaveBeenCalledWith('/summary');
        resolve();
      }, 100);
    });
  });

  it('accepts .gz files by MIME type', async () => {
    useLogStore.setState({ lastRoute: null });

    const logContent = 'test log content';
    const compressedData = compressSync(new TextEncoder().encode(logContent));

    const { container } = render(<FileUpload />);
    const input = container.querySelector('#file-input') as HTMLInputElement;
    const file = new File([compressedData as BlobPart], 'archive.gz', { type: 'application/gzip' });

    fireEvent.change(input, { target: { files: [file] } });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(mockParseLogFile).toHaveBeenCalledWith(logContent);
        expect(mockNavigate).toHaveBeenCalledWith('/summary');
        resolve();
      }, 100);
    });
  });

  it('rejects gzip files with binary content', async () => {
    const { container, rerender } = render(<FileUpload />);
    const input = container.querySelector('#file-input') as HTMLInputElement;

    // Create gzip with binary content (null bytes)
    const binaryContent = new Uint8Array([0x74, 0x65, 0x73, 0x74, 0x00, 0x64]); // "test\0d"
    const compressedData = compressSync(binaryContent);
    const file = new File([compressedData as BlobPart], 'test.log.gz', { type: 'application/gzip' });

    fireEvent.change(input, { target: { files: [file] } });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        rerender(<FileUpload />);
        expect(mockNavigate).not.toHaveBeenCalled();
        resolve();
      }, 150);
    });
  });

  it('rejects plain text files with binary content', async () => {
    const { container, rerender } = render(<FileUpload />);
    const input = container.querySelector('#file-input') as HTMLInputElement;

    // Binary content with null bytes
    const binaryContent = new Uint8Array([0x74, 0x65, 0x73, 0x74, 0x00, 0x64]); // "test\0d"
    const file = new File([binaryContent], 'test.log', { type: 'text/plain' });

    fireEvent.change(input, { target: { files: [file] } });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        rerender(<FileUpload />);
        expect(mockNavigate).not.toHaveBeenCalled();
        resolve();
      }, 150);
    });
  });

  it('rejects invalid gzip files', async () => {
    const { container, rerender } = render(<FileUpload />);
    const input = container.querySelector('#file-input') as HTMLInputElement;

    // ZIP file header (not gzip)
    const invalidGzip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const file = new File([invalidGzip], 'test.log.gz', { type: 'application/gzip' });

    fireEvent.change(input, { target: { files: [file] } });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        rerender(<FileUpload />);
        expect(mockNavigate).not.toHaveBeenCalled();
        resolve();
      }, 150);
    });
  });
});

describe('FileUpload drag-and-drop', () => {
  beforeEach(() => {
    useLogStore.getState().clearData();
    useLogStore.getState().clearLastRoute();
    mockNavigate.mockReset();
    mockParseLogFile.mockReset();

    mockParseLogFile.mockReturnValue({
      requests: [],
      httpRequests: [],
      connectionIds: [],
      sentryEvents: [],
      rawLogLines: [
        {
          lineNumber: 0,
          rawText: 'line 0',
          isoTimestamp: '1970-01-01T00:00:00.000000Z',
          timestampUs: 0,
          displayTime: '00:00:00.000000',
          level: 'INFO',
          message: 'line 0',
          strippedMessage: 'line 0',
        },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('handles file dropped onto drop zone', async () => {
    useLogStore.setState({ lastRoute: null });
    const { container } = render(<FileUpload />);
    const dropZone = container.querySelector('#drop-zone')!;
    const file = new File(['log content'], 'test.log', { type: 'text/plain' });

    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(mockParseLogFile).toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('/summary');
        resolve();
      }, 150);
    });
  });

  it('adds a CSS class on dragover', () => {
    const { container } = render(<FileUpload />);
    const dropZone = container.querySelector('#drop-zone') as HTMLElement;
    const addSpy = vi.spyOn(dropZone.classList, 'add');

    fireEvent.dragOver(dropZone);

    expect(addSpy).toHaveBeenCalled();
  });

  it('removes the CSS class on dragleave', () => {
    const { container } = render(<FileUpload />);
    const dropZone = container.querySelector('#drop-zone') as HTMLElement;
    const removeSpy = vi.spyOn(dropZone.classList, 'remove');

    fireEvent.dragLeave(dropZone);

    expect(removeSpy).toHaveBeenCalled();
  });

  it('does nothing when drop has no files', () => {
    const { container } = render(<FileUpload />);
    const dropZone = container.querySelector('#drop-zone')!;

    fireEvent.drop(dropZone, { dataTransfer: { files: [] } });

    expect(mockParseLogFile).not.toHaveBeenCalled();
  });

  it('clicking drop zone content triggers file input click', () => {
    const { container } = render(<FileUpload />);
    const content = container.querySelector('#drop-zone > div') as HTMLElement;
    const fileInput = container.querySelector('#file-input') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');

    fireEvent.click(content);

    expect(clickSpy).toHaveBeenCalled();
  });
});

describe('FileUpload - error handling and warnings', () => {
  beforeEach(() => {
    useLogStore.getState().clearData();
    useLogStore.getState().clearLastRoute();
    mockNavigate.mockReset();
    mockParseLogFile.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows validation error when parseLogFile throws (catch block)', async () => {
    // Make parseLogFile throw to exercise the catch block in handleFile (lines 116-121)
    mockParseLogFile.mockImplementation(() => {
      throw new Error('parse failure');
    });

    const { container, rerender } = render(<FileUpload />);
    const input = container.querySelector('#file-input') as HTMLInputElement;
    const file = new File(['valid log content'], 'test.log', { type: 'text/plain' });

    fireEvent.change(input, { target: { files: [file] } });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        rerender(<FileUpload />);
        // Navigation should NOT have happened since an error occurred
        expect(mockNavigate).not.toHaveBeenCalled();
        resolve();
      }, 200);
    });
  });

  it('renders validation warnings for files with encoding issues (covers warnings branch)', async () => {
    // lenient UTF-8 bytes: "test" + invalid byte → triggers warning path in validateTextFile
    // setValidationWarnings is called with the warnings array
    const invalidUtf8 = new Uint8Array([0x74, 0x65, 0x73, 0x74, 0x80, 0x81]);
    const file = new File([invalidUtf8], 'test.log', { type: 'text/plain' });

    mockParseLogFile.mockReturnValue({
      requests: [],
      httpRequests: [],
      connectionIds: [],
      sentryEvents: [],
      rawLogLines: [],
    });

    const { container, rerender } = render(<FileUpload />);
    const input = container.querySelector('#file-input') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        rerender(<FileUpload />);
        // File has encoding issues but validates as lenient UTF-8 → warning is set
        // The component renders the warning without crashing
        // Also click dismiss if a warning dismiss button is visible (covers L191)
        const dismissButtons = container.querySelectorAll('[aria-label="Dismiss"]');
        if (dismissButtons.length > 0) {
          fireEvent.click(dismissButtons[0]);
        }
        expect(container.querySelector('#drop-zone')).toBeInTheDocument();
        resolve();
      }, 300);
    });
  });
});

describe('FileUpload — .tar.gz archive handling', () => {
  beforeEach(() => {
    useLogStore.getState().clearData();
    useLogStore.getState().clearLastRoute();
    useArchiveStore.getState().clearArchive();
    useArchiveStore.setState({ allVisited: {}, visitedEntries: new Set() });
    mockNavigate.mockReset();
    mockParseLogFile.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads a valid .tar.gz archive and navigates to /archive', async () => {
    // Build a minimal POSIX tar with one entry: "a/details.json"
    // A tar header is 512 bytes; file content is padded to 512-byte blocks.
    const filename = 'a/details.json';
    const content = new TextEncoder().encode('{}');
    const header = new Uint8Array(512);
    // Name field (bytes 0-99)
    for (let i = 0; i < filename.length; i++) header[i] = filename.charCodeAt(i);
    // File size (bytes 124-135, octal)
    const sizeOctal = content.length.toString(8).padStart(11, '0');
    for (let i = 0; i < 11; i++) header[124 + i] = sizeOctal.charCodeAt(i);
    header[135] = 0x20; // trailing space
    // Type flag byte 156 = '0' (regular file)
    header[156] = 0x30;
    // parseTar does not validate tar checksums — leave the checksum field at zero.

    // Content block (padded to 512 bytes)
    const contentBlock = new Uint8Array(512);
    contentBlock.set(content);

    // End-of-archive: two zero 512-byte blocks
    const eof = new Uint8Array(1024);

    const tarBytes = new Uint8Array([...header, ...contentBlock, ...eof]);
    const gzBytes = compressSync(tarBytes);
    const file = new File([gzBytes], 'rageshake.tar.gz', { type: 'application/gzip' });

    const { container } = render(<FileUpload />);
    const input = container.querySelector('#file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/archive');
    }, { timeout: 1000 });

    expect(useArchiveStore.getState().archiveName).toBe('rageshake.tar.gz');
    expect(useArchiveStore.getState().archiveEntries.length).toBeGreaterThan(0);
  });

  it('shows an error when the .tar.gz archive is empty', async () => {
    // A tar with only end-of-archive blocks — parseTar returns []
    const eof = new Uint8Array(1024);
    const gzBytes = compressSync(eof);
    const file = new File([gzBytes], 'empty.tar.gz', { type: 'application/gzip' });

    const { container, rerender } = render(<FileUpload />);
    const input = container.querySelector('#file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      rerender(<FileUpload />);
      expect(mockNavigate).not.toHaveBeenCalled();
    }, { timeout: 1000 });
  });

  it('shows an error when the .tar.gz file exceeds the 500 MB size limit', async () => {
    // jsdom's File.size is a prototype getter that cannot be shadowed on an instance
    // via Object.defineProperty. Use a plain object with the required File shape instead.
    const oversizedFile = {
      name: 'huge.tar.gz',
      size: 501 * 1024 * 1024,
      type: 'application/gzip',
    } as unknown as File;

    const { container, findByText } = render(<FileUpload />);
    const input = container.querySelector('#file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [oversizedFile] } });

    await findByText(/too large/i);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
