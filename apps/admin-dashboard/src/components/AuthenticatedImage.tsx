import { useEffect, useState } from 'react';
import { ErrorBanner, Spinner } from './Spinner';

/**
 * Renders a document/selfie image fetched through the admin-only
 * image-proxy endpoint. A plain `<img src>` can't carry the Authorization
 * header the endpoint requires, so this fetches the bytes as a blob (via
 * `load`, injected by the caller — see ApplicantDetail/BusinessDetail) and
 * renders them as an object URL, revoked on unmount/change so this doesn't
 * leak memory across a long dashboard session.
 */
export function AuthenticatedImage({
  load,
  alt,
}: {
  load: () => Promise<Blob>;
  alt: string;
}) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error'; message: string }
  >({ status: 'loading' });

  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;
    setState({ status: 'loading' });
    load()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: 'ready', url: objectUrl });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to load image',
        });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') return <ErrorBanner message={state.message} />;
  return (
    <img
      src={state.url}
      alt={alt}
      className="max-h-96 w-full rounded-md border border-slate-200 object-contain"
    />
  );
}
