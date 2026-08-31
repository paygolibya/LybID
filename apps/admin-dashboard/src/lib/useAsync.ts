import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api-client';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

/**
 * Small shared data-fetching pattern used by every list/detail page —
 * avoids repeating the same loading/error/data boilerplate five times.
 * Re-runs whenever `deps` changes; `reload` lets a page (e.g. after a
 * review action) force a fresh fetch without waiting for a dep to change.
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    fn()
      .then((data) => setState({ status: 'ready', data }))
      .catch((err: unknown) =>
        setState({
          status: 'error',
          message:
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Something went wrong',
        }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: () => setNonce((n) => n + 1) } as AsyncState<T> & {
    reload: () => void;
  };
}
