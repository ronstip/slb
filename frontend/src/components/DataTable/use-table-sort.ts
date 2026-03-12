import { useState, useMemo } from 'react';

export type SortDir = 'asc' | 'desc';

export function useTableSort<T>(
  data: T[],
  defaultKey: string,
  defaultDir: SortDir = 'desc',
) {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  function handleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      let av = ((a as Record<string, unknown>)[sortKey] ?? 0) as number | string;
      let bv = ((b as Record<string, unknown>)[sortKey] ?? 0) as number | string;
      if (sortKey === 'posted_at') {
        av = String(av);
        bv = String(bv);
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      av = Number(av);
      bv = Number(bv);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [data, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, handleSort };
}
