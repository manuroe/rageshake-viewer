import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useClickOutside } from '../useClickOutside';

function fireMousedown(target: HTMLElement) {
  // Dispatch on the element itself so that event.target is set correctly and
  // the event bubbles up to the document listener.
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

describe('useClickOutside', () => {
  let container: HTMLDivElement;
  let outsideEl: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    outsideEl = document.createElement('div');
    document.body.appendChild(container);
    document.body.appendChild(outsideEl);
  });

  afterEach(() => {
    document.body.removeChild(container);
    document.body.removeChild(outsideEl);
  });

  it('calls onClose when clicking outside the referenced element', () => {
    const onClose = vi.fn();
    const ref = createRef<HTMLDivElement>();
    // Attach the ref to the container element imperatively
    (ref as React.MutableRefObject<HTMLDivElement>).current = container;

    renderHook(() => useClickOutside(ref, onClose, true));

    fireMousedown(outsideEl);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when clicking inside the referenced element', () => {
    const onClose = vi.fn();
    const ref = createRef<HTMLDivElement>();
    (ref as React.MutableRefObject<HTMLDivElement>).current = container;

    renderHook(() => useClickOutside(ref, onClose, true));

    fireMousedown(container);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not call onClose when disabled', () => {
    const onClose = vi.fn();
    const ref = createRef<HTMLDivElement>();
    (ref as React.MutableRefObject<HTMLDivElement>).current = container;

    renderHook(() => useClickOutside(ref, onClose, false));

    fireMousedown(outsideEl);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('defaults enabled to true', () => {
    const onClose = vi.fn();
    const ref = createRef<HTMLDivElement>();
    (ref as React.MutableRefObject<HTMLDivElement>).current = container;

    renderHook(() => useClickOutside(ref, onClose));

    fireMousedown(outsideEl);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('removes listener when enabled transitions from true to false', () => {
    const onClose = vi.fn();
    const ref = createRef<HTMLDivElement>();
    (ref as React.MutableRefObject<HTMLDivElement>).current = container;

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useClickOutside(ref, onClose, enabled),
      { initialProps: { enabled: true } }
    );

    rerender({ enabled: false });
    fireMousedown(outsideEl);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes the listener on unmount', () => {
    const onClose = vi.fn();
    const ref = createRef<HTMLDivElement>();
    (ref as React.MutableRefObject<HTMLDivElement>).current = container;

    const { unmount } = renderHook(() => useClickOutside(ref, onClose, true));
    unmount();
    fireMousedown(outsideEl);

    expect(onClose).not.toHaveBeenCalled();
  });
});
