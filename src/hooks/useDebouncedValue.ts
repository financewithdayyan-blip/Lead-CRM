import { useEffect, useState } from 'react';

/** Delays reflecting `value` until it's stopped changing for `delayMs` — keeps
 * a search box's server request from firing on every keystroke. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
