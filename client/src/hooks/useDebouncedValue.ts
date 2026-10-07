import { useEffect, useState } from 'react';

/** The value, but only after it has stopped changing for `delay` ms (e.g. search-as-you-type). */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
