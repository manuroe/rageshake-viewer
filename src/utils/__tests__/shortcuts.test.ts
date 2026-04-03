import { describe, it, expect, vi, afterEach } from 'vitest';
import { isInputFocused, metaKey } from '../shortcuts';

// ---------------------------------------------------------------------------
// isInputFocused
// ---------------------------------------------------------------------------

describe('isInputFocused', () => {
  afterEach(() => {
    // Blur any element that may have been focused during the test
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  it('returns false when no interactive element is focused', () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    expect(isInputFocused()).toBe(false);
  });

  it('returns true when an <input> element is focused', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(isInputFocused()).toBe(true);
    document.body.removeChild(input);
  });

  it('returns true when a <textarea> element is focused', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    expect(isInputFocused()).toBe(true);
    document.body.removeChild(textarea);
  });

  it('returns true when a contentEditable element is the active element', () => {
    // jsdom does not implement HTMLElement.isContentEditable (returns undefined),
    // so we patch both the element property and document.activeElement directly.
    const div = document.createElement('div');
    div.contentEditable = 'true';
    Object.defineProperty(div, 'isContentEditable', { get: () => true });
    document.body.appendChild(div);
    Object.defineProperty(document, 'activeElement', {
      get: () => div,
      configurable: true,
    });
    try {
      expect(isInputFocused()).toBe(true);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (document as unknown as Record<string, unknown>).activeElement;
    }
    document.body.removeChild(div);
  });

  it('returns false when a <button> is focused', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    expect(isInputFocused()).toBe(false);
    document.body.removeChild(button);
  });

  it('returns false when a <div> (non-editable) is focused', () => {
    const div = document.createElement('div');
    div.tabIndex = 0;
    document.body.appendChild(div);
    div.focus();
    expect(isInputFocused()).toBe(false);
    document.body.removeChild(div);
  });
});

// ---------------------------------------------------------------------------
// metaKey
// ---------------------------------------------------------------------------

describe('metaKey', () => {
  it('is a non-empty string (⌘ on Mac, Ctrl elsewhere)', () => {
    expect(typeof metaKey).toBe('string');
    expect(metaKey.length).toBeGreaterThan(0);
  });

  it('is either ⌘ or Ctrl', () => {
    expect(['⌘', 'Ctrl']).toContain(metaKey);
  });
});
