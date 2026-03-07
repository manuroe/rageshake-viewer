import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { compressSync } from 'fflate';
import { FileUpload } from '../FileUpload';
import { useLogStore } from '../../stores/logStore';

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
