import { describe, expect, it } from 'vitest';

import {
  InvalidAssetProcessingTransitionError,
  MissingAssetProcessingFailureError,
  assertAssetProcessingTransition,
  canTransitionAssetProcessingStatus,
  createAssetProcessingFailure,
  transitionAssetProcessing,
} from '../../../apps/api/src/domain/asset-processing';

describe('asset processing state machine', () => {
  it('accepts the canonical pipeline and idempotent duplicate delivery', () => {
    expect(canTransitionAssetProcessingStatus('uploaded', 'inspecting')).toBe(true);
    expect(canTransitionAssetProcessingStatus('inspecting', 'processing')).toBe(true);
    expect(canTransitionAssetProcessingStatus('processing', 'ready')).toBe(true);
    expect(canTransitionAssetProcessingStatus('processing', 'processing')).toBe(true);
    expect(canTransitionAssetProcessingStatus('processing', 'processing', {
      allowIdempotent: false,
    })).toBe(false);
  });

  it('rejects invalid jumps with a stable machine code', () => {
    expect(() => assertAssetProcessingTransition('uploaded', 'ready')).toThrow(
      InvalidAssetProcessingTransitionError,
    );
    try {
      assertAssetProcessingTransition('ready', 'failed');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'INVALID_ASSET_PROCESSING_TRANSITION',
        from: 'ready',
        to: 'failed',
      });
    }
  });

  it('requires a categorized failure and clears it on retry', () => {
    expect(() => transitionAssetProcessing({ status: 'processing' }, 'failed')).toThrow(
      MissingAssetProcessingFailureError,
    );

    const failure = createAssetProcessingFailure(
      'DERIVATIVE_GENERATION_FAILED',
      'processing',
      '  encoder failed\nwithout secrets  ',
      { diagnostics: { stageAttempt: 2 } },
    );
    const failed = transitionAssetProcessing({ status: 'processing' }, 'failed', { failure });
    expect(failed).toEqual({
      status: 'failed',
      failure: {
        category: 'DERIVATIVE_GENERATION_FAILED',
        stage: 'processing',
        message: 'encoder failed without secrets',
        retryable: true,
        diagnostics: { stageAttempt: 2 },
      },
    });
    expect(transitionAssetProcessing(failed, 'inspecting')).toEqual({ status: 'inspecting' });
  });

  it('allows a ready logical asset to reprocess without changing its identity', () => {
    expect(transitionAssetProcessing({ status: 'ready' }, 'inspecting')).toEqual({
      status: 'inspecting',
    });
  });
});

