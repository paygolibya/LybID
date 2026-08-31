import { describe, expect, it } from 'vitest';
import {
  flowReducer,
  initialFlowState,
  nextCaptureKind,
  type FlowState,
} from '../src/lib/state-machine';

const blob = (): Blob => new Blob(['x'], { type: 'image/jpeg' });

describe('nextCaptureKind', () => {
  it('walks PASSPORT -> BIRTH_CERTIFICATE -> SELFIE -> undefined', () => {
    expect(nextCaptureKind('PASSPORT')).toBe('BIRTH_CERTIFICATE');
    expect(nextCaptureKind('BIRTH_CERTIFICATE')).toBe('SELFIE');
    expect(nextCaptureKind('SELFIE')).toBeUndefined();
  });
});

describe('flowReducer', () => {
  it('starts at welcome', () => {
    expect(initialFlowState.step).toEqual({ name: 'welcome' });
  });

  it('START moves to capturing the first document (PASSPORT)', () => {
    const state = flowReducer(initialFlowState, { type: 'START' });
    expect(state.step).toEqual({ name: 'capture', kind: 'PASSPORT' });
  });

  it('CAPTURED stores the blob and moves to review for that kind', () => {
    const b = blob();
    const state = flowReducer(initialFlowState, {
      type: 'CAPTURED',
      kind: 'PASSPORT',
      blob: b,
    });
    expect(state.step).toEqual({ name: 'review', kind: 'PASSPORT' });
    expect(state.captures.PASSPORT).toBe(b);
  });

  it('RETAKE goes back to capture for that kind, keeping earlier captures', () => {
    let state: FlowState = flowReducer(initialFlowState, {
      type: 'CAPTURED',
      kind: 'PASSPORT',
      blob: blob(),
    });
    state = flowReducer(state, { type: 'RETAKE', kind: 'PASSPORT' });
    expect(state.step).toEqual({ name: 'capture', kind: 'PASSPORT' });
    expect(state.captures.PASSPORT).toBeDefined();
  });

  it('CONFIRM walks through all three captures in order, then to processing', () => {
    let state: FlowState = flowReducer(initialFlowState, { type: 'START' });
    state = flowReducer(state, { type: 'CONFIRM', kind: 'PASSPORT' });
    expect(state.step).toEqual({ name: 'capture', kind: 'BIRTH_CERTIFICATE' });

    state = flowReducer(state, { type: 'CONFIRM', kind: 'BIRTH_CERTIFICATE' });
    expect(state.step).toEqual({ name: 'capture', kind: 'SELFIE' });

    state = flowReducer(state, { type: 'CONFIRM', kind: 'SELFIE' });
    expect(state.step).toEqual({ name: 'processing' });
  });

  it('SUBMIT_SUCCESS moves to completion', () => {
    const state = flowReducer(
      { ...initialFlowState, step: { name: 'processing' } },
      { type: 'SUBMIT_SUCCESS' },
    );
    expect(state.step).toEqual({ name: 'completion' });
  });

  it('ERROR carries the message and an optional resumeKind', () => {
    const state = flowReducer(initialFlowState, {
      type: 'ERROR',
      message: 'upload failed',
      resumeKind: 'BIRTH_CERTIFICATE',
    });
    expect(state.step).toEqual({
      name: 'error',
      message: 'upload failed',
      resumeKind: 'BIRTH_CERTIFICATE',
    });
  });

  it('CONTINUE from an error with a resumeKind goes back to that capture step', () => {
    const errored = flowReducer(initialFlowState, {
      type: 'ERROR',
      message: 'x',
      resumeKind: 'SELFIE',
    });
    const state = flowReducer(errored, { type: 'CONTINUE' });
    expect(state.step).toEqual({ name: 'capture', kind: 'SELFIE' });
  });

  it('CONTINUE from an error with no resumeKind goes back to welcome', () => {
    const errored = flowReducer(initialFlowState, {
      type: 'ERROR',
      message: 'config error',
    });
    const state = flowReducer(errored, { type: 'CONTINUE' });
    expect(state.step).toEqual({ name: 'welcome' });
  });

  it('CONTINUE is a no-op outside the error step', () => {
    const state = flowReducer(initialFlowState, { type: 'CONTINUE' });
    expect(state.step).toEqual({ name: 'welcome' });
  });
});
