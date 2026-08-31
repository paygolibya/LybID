// Pure reducer driving the capture flow — deliberately separate from any
// React/DOM/camera concerns so the step sequencing itself is unit-testable
// without mocking getUserMedia or rendering anything. See the plan's
// "ordered implementation steps" for why this comes before any UI.

export type CaptureKind = 'PASSPORT' | 'BIRTH_CERTIFICATE' | 'SELFIE';

// Order Libyan banks actually require both passport AND birth certificate
// (see Phase 1) — this isn't a free "pick one" selector, it's a guided
// sequence through all three captures.
const CAPTURE_ORDER: readonly CaptureKind[] = [
  'PASSPORT',
  'BIRTH_CERTIFICATE',
  'SELFIE',
];

export type FlowStep =
  | { name: 'welcome' }
  | { name: 'capture'; kind: CaptureKind }
  | { name: 'review'; kind: CaptureKind }
  | { name: 'processing' }
  | { name: 'completion' }
  // resumeKind, if set, is where CONTINUE should send the flow back to —
  // an upload/poll failure resumes at the capture that failed, not the
  // beginning; a failure with no specific step (e.g. minting/config error)
  // has no resumeKind.
  | { name: 'error'; message: string; resumeKind?: CaptureKind };

export interface FlowState {
  step: FlowStep;
  captures: Partial<Record<CaptureKind, Blob>>;
}

export type FlowAction =
  | { type: 'START' }
  | { type: 'CAPTURED'; kind: CaptureKind; blob: Blob }
  | { type: 'RETAKE'; kind: CaptureKind }
  | { type: 'CONFIRM'; kind: CaptureKind }
  | { type: 'SUBMIT_SUCCESS' }
  | { type: 'ERROR'; message: string; resumeKind?: CaptureKind }
  | { type: 'CONTINUE' };

export const initialFlowState: FlowState = {
  step: { name: 'welcome' },
  captures: {},
};

export function nextCaptureKind(kind: CaptureKind): CaptureKind | undefined {
  return CAPTURE_ORDER[CAPTURE_ORDER.indexOf(kind) + 1];
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'START':
      return { ...state, step: { name: 'capture', kind: CAPTURE_ORDER[0] } };

    case 'CAPTURED':
      return {
        ...state,
        captures: { ...state.captures, [action.kind]: action.blob },
        step: { name: 'review', kind: action.kind },
      };

    case 'RETAKE':
      return { ...state, step: { name: 'capture', kind: action.kind } };

    case 'CONFIRM': {
      const next = nextCaptureKind(action.kind);
      return {
        ...state,
        step: next ? { name: 'capture', kind: next } : { name: 'processing' },
      };
    }

    case 'SUBMIT_SUCCESS':
      return { ...state, step: { name: 'completion' } };

    case 'ERROR':
      return {
        ...state,
        step: {
          name: 'error',
          message: action.message,
          resumeKind: action.resumeKind,
        },
      };

    case 'CONTINUE': {
      if (state.step.name !== 'error') return state;
      const { resumeKind } = state.step;
      return {
        ...state,
        step: resumeKind
          ? { name: 'capture', kind: resumeKind }
          : { name: 'welcome' },
      };
    }

    default:
      return state;
  }
}
