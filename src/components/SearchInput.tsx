import { useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { InputHTMLAttributes } from 'react';
import styles from './SearchInput.module.css';

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  /** Current input value */
  value: string;
  /** Called when input value changes */
  onChange: (value: string) => void;
  /** Optional callback when cleared (defaults to calling onChange with '') */
  onClear?: () => void;
  /** Input placeholder text */
  placeholder?: string;
  /** Additional CSS class for the container */
  className?: string;
  /** Whether to expand on focus (default: true) */
  expandOnFocus?: boolean;
}

/** Imperative handle exposed via ref */
export interface SearchInputHandle {
  focus: () => void;
}

/**
 * Reusable search/filter input with clear button.
 * Handles the visual presentation - parent manages debouncing if needed.
 */
export const SearchInput = forwardRef<SearchInputHandle, SearchInputProps>(function SearchInput({
  value,
  onChange,
  onClear,
  placeholder = 'Search...',
  className = '',
  expandOnFocus = true,
  ...inputProps
}: SearchInputProps, ref) {
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  const handleClear = useCallback(() => {
    if (onClear) {
      onClear();
    } else {
      onChange('');
    }
    inputRef.current?.focus();
  }, [onChange, onClear]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      handleClear();
    }
    // Forward to parent's onKeyDown if provided
    inputProps.onKeyDown?.(e);
  }, [handleClear, inputProps]);

  const hasValue = value.length > 0;
  const containerClass = `${styles.container} ${className}`.trim();
  const inputClass = `${styles.input} ${expandOnFocus ? styles.expandable : ''}`.trim();

  return (
    <div className={containerClass}>
      <input
        ref={inputRef}
        type="text"
        className={inputClass}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        {...inputProps}
        onKeyDown={handleKeyDown}
      />
      {hasValue && (
        <button
          type="button"
          className={styles.clearButton}
          onClick={handleClear}
          title="Clear (Esc)"
          aria-label="Clear input"
        >
          ×
        </button>
      )}
    </div>
  );
});
