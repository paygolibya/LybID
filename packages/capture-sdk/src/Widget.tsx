import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { ProgressBar } from './components/ProgressBar';
import {
  ApiClient,
  BIOMETRIC_TERMINAL_STATUSES,
  DOCUMENT_TERMINAL_STATUSES,
  pollUntilTerminal,
} from './lib/api-client';
import {
  flowReducer,
  initialFlowState,
  type CaptureKind,
} from './lib/state-machine';
import { Completion } from './steps/Completion';
import { DocumentCapture } from './steps/DocumentCapture';
import { ErrorScreen } from './steps/ErrorScreen';
import { Processing } from './steps/Processing';
import { ReviewCapture } from './steps/ReviewCapture';
import { Welcome } from './steps/Welcome';

export interface WidgetConfig {
  sessionToken: string;
  /** Never hardcoded to one SaaS endpoint — this is a self-hosted
   * platform, an integrator points this at their own LybID instance. */
  apiBaseUrl: string;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

const CAPTURE_STEP_INDEX: Record<CaptureKind, number> = {
  PASSPORT: 1,
  BIRTH_CERTIFICATE: 2,
  SELFIE: 3,
};

const LABELS: Record<CaptureKind, string> = {
  PASSPORT: 'passport',
  BIRTH_CERTIFICATE: 'birth certificate',
  SELFIE: 'selfie',
};

function Layout({
  children,
  progress,
}: {
  children: ReactNode;
  progress?: { current: number; total: number };
}) {
  return (
    <div className="flex min-h-[480px] w-full max-w-sm flex-col bg-white font-sans text-slate-900 shadow-xl">
      <Header />
      {progress && (
        <ProgressBar
          current={progress.current}
          total={progress.total}
          label="Verification"
        />
      )}
      <div className="flex flex-1 flex-col justify-center">{children}</div>
      <Footer />
    </div>
  );
}

export function Widget({ config }: { config: WidgetConfig }) {
  const [state, dispatch] = useReducer(flowReducer, initialFlowState);
  const [statusText, setStatusText] = useState('');
  const apiClient = useRef(
    new ApiClient(config.apiBaseUrl, config.sessionToken),
  ).current;
  // Document/biometric-check ids accumulate across the flow — a plain ref,
  // not state, since nothing needs to re-render off these directly.
  const resourceIds = useRef<{
    PASSPORT?: string;
    BIRTH_CERTIFICATE?: string;
    SELFIE?: string;
    biometricCheckId?: string;
  }>({});

  const handleError = useCallback(
    (message: string, resumeKind?: CaptureKind) => {
      dispatch({ type: 'ERROR', message, resumeKind });
      config.onError?.(new Error(message));
    },
    [config],
  );

  const handleConfirm = useCallback(
    async (kind: CaptureKind) => {
      const blob = state.captures[kind];
      if (!blob) return;
      try {
        setStatusText(`Uploading your ${LABELS[kind]}…`);
        const doc = await apiClient.uploadDocument(
          kind,
          blob,
          `${kind.toLowerCase()}.jpg`,
        );
        resourceIds.current[kind] = doc.id;
        dispatch({ type: 'CONFIRM', kind });
      } catch {
        handleError(
          `We couldn't upload your ${LABELS[kind]}. Please try capturing it again.`,
          kind,
        );
      }
    },
    [apiClient, state.captures, handleError],
  );

  // Runs once when the flow reaches 'processing' — creates the biometric
  // check (needs the just-uploaded selfie id) and polls all three
  // resources to a terminal status before showing Completion. See the
  // plan: this never computes or shows a pass/fail decision, only that
  // submission + processing finished.
  useEffect(() => {
    if (state.step.name !== 'processing') return;
    let cancelled = false;

    (async () => {
      try {
        const { PASSPORT: passportId, BIRTH_CERTIFICATE: birthCertId, SELFIE: selfieId } =
          resourceIds.current;
        if (!passportId || !birthCertId || !selfieId) {
          throw new Error('Something went wrong — please restart verification.');
        }

        setStatusText('Starting your biometric check…');
        const check = await apiClient.createBiometricCheck(selfieId);
        resourceIds.current.biometricCheckId = check.id;

        setStatusText('Verifying your passport…');
        await pollUntilTerminal(() => apiClient.getDocument(passportId), (s) =>
          DOCUMENT_TERMINAL_STATUSES.has(s),
        );

        setStatusText('Verifying your birth certificate…');
        await pollUntilTerminal(() => apiClient.getDocument(birthCertId), (s) =>
          DOCUMENT_TERMINAL_STATUSES.has(s),
        );

        setStatusText('Verifying your selfie…');
        await pollUntilTerminal(
          () => apiClient.getBiometricCheck(check.id),
          (s) => BIOMETRIC_TERMINAL_STATUSES.has(s),
        );

        if (cancelled) return;
        dispatch({ type: 'SUBMIT_SUCCESS' });
        config.onComplete?.();
      } catch (err) {
        if (cancelled) return;
        handleError(
          err instanceof Error
            ? err.message
            : 'Verification failed. Please try again.',
        );
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step.name]);

  switch (state.step.name) {
    case 'welcome':
      return (
        <Layout>
          <Welcome onStart={() => dispatch({ type: 'START' })} />
        </Layout>
      );

    case 'capture': {
      const { kind } = state.step;
      return (
        <Layout progress={{ current: CAPTURE_STEP_INDEX[kind], total: 3 }}>
          <DocumentCapture
            kind={kind}
            onCapture={(blob) => dispatch({ type: 'CAPTURED', kind, blob })}
          />
        </Layout>
      );
    }

    case 'review': {
      const { kind } = state.step;
      const blob = state.captures[kind];
      if (!blob) return null; // unreachable — CAPTURED always sets this before entering 'review'
      return (
        <Layout progress={{ current: CAPTURE_STEP_INDEX[kind], total: 3 }}>
          <ReviewCapture
            kind={kind}
            blob={blob}
            onRetake={() => dispatch({ type: 'RETAKE', kind })}
            onConfirm={() => handleConfirm(kind)}
          />
        </Layout>
      );
    }

    case 'processing':
      return (
        <Layout>
          <Processing statusText={statusText || 'Processing…'} />
        </Layout>
      );

    case 'completion':
      return (
        <Layout>
          <Completion />
        </Layout>
      );

    case 'error':
      return (
        <Layout>
          <ErrorScreen
            message={state.step.message}
            onContinue={() => dispatch({ type: 'CONTINUE' })}
          />
        </Layout>
      );
  }
}
