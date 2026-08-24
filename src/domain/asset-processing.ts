export const ASSET_PROCESSING_STATUSES = [
  'uploaded',
  'inspecting',
  'processing',
  'ready',
  'failed',
] as const;

export type AssetProcessingStatus = (typeof ASSET_PROCESSING_STATUSES)[number];

export const ASSET_PROCESSING_FAILURE_CATEGORIES = [
  'UNSUPPORTED_MEDIA_TYPE',
  'SIGNATURE_MISMATCH',
  'FILE_TOO_LARGE',
  'MALWARE_DETECTED',
  'POLICY_REJECTED',
  'IMAGE_DECODE_FAILED',
  'VIDEO_DECODE_FAILED',
  'VIDEO_DURATION_UNKNOWN',
  'VIDEO_PROFILE_UNAVAILABLE',
  'METADATA_INSPECTION_FAILED',
  'DERIVATIVE_GENERATION_FAILED',
  'STORAGE_ERROR',
  'PROCESSING_TIMEOUT',
  'UNKNOWN_PROCESSING_ERROR',
] as const;

export type AssetProcessingFailureCategory =
  (typeof ASSET_PROCESSING_FAILURE_CATEGORIES)[number];

export const ASSET_PROCESSING_STAGES = [
  'upload_validation',
  'inspection',
  'processing',
  'storage',
  'unknown',
] as const;

export type AssetProcessingStage = (typeof ASSET_PROCESSING_STAGES)[number];
export type SafeDiagnosticValue = boolean | number | string | null;

export interface AssetProcessingFailure {
  readonly category: AssetProcessingFailureCategory;
  readonly stage: AssetProcessingStage;
  readonly message: string;
  readonly retryable: boolean;
  readonly diagnostics?: Readonly<Record<string, SafeDiagnosticValue>>;
  readonly occurredAt?: string;
}

export interface AssetProcessingSnapshot {
  readonly status: AssetProcessingStatus;
  readonly failure?: AssetProcessingFailure;
}

const transitions: Readonly<Record<AssetProcessingStatus, readonly AssetProcessingStatus[]>> = {
  uploaded: ['inspecting', 'failed'],
  inspecting: ['processing', 'failed'],
  processing: ['ready', 'failed'],
  // A ready logical asset can be reprocessed without changing its stable ID.
  ready: ['inspecting'],
  failed: ['inspecting', 'processing'],
};

export class InvalidAssetProcessingTransitionError extends Error {
  readonly code = 'INVALID_ASSET_PROCESSING_TRANSITION';
  readonly from: AssetProcessingStatus;
  readonly to: AssetProcessingStatus;

  constructor(from: AssetProcessingStatus, to: AssetProcessingStatus) {
    super(`Asset processing cannot transition from ${from} to ${to}.`);
    this.name = 'InvalidAssetProcessingTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class MissingAssetProcessingFailureError extends Error {
  readonly code = 'ASSET_PROCESSING_FAILURE_REQUIRED';

  constructor() {
    super('A machine-readable failure is required when asset processing fails.');
    this.name = 'MissingAssetProcessingFailureError';
  }
}

/** Same-state delivery is accepted so duplicate worker messages are harmless. */
export function canTransitionAssetProcessingStatus(
  from: AssetProcessingStatus,
  to: AssetProcessingStatus,
  options: { readonly allowIdempotent?: boolean } = {},
): boolean {
  if (from === to) {
    return options.allowIdempotent ?? true;
  }

  return transitions[from].includes(to);
}

export function assertAssetProcessingTransition(
  from: AssetProcessingStatus,
  to: AssetProcessingStatus,
  options: { readonly allowIdempotent?: boolean } = {},
): void {
  if (!canTransitionAssetProcessingStatus(from, to, options)) {
    throw new InvalidAssetProcessingTransitionError(from, to);
  }
}

export function transitionAssetProcessing(
  current: AssetProcessingSnapshot,
  nextStatus: AssetProcessingStatus,
  options: {
    readonly failure?: AssetProcessingFailure;
    readonly allowIdempotent?: boolean;
  } = {},
): AssetProcessingSnapshot {
  assertAssetProcessingTransition(current.status, nextStatus, options);

  if (nextStatus === 'failed') {
    const failure = options.failure ?? (current.status === 'failed' ? current.failure : undefined);
    if (failure === undefined) {
      throw new MissingAssetProcessingFailureError();
    }
    return Object.freeze({ status: nextStatus, failure });
  }

  return Object.freeze({ status: nextStatus });
}

export function createAssetProcessingFailure(
  category: AssetProcessingFailureCategory,
  stage: AssetProcessingStage,
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly diagnostics?: Readonly<Record<string, SafeDiagnosticValue>>;
    readonly occurredAt?: string;
  } = {},
): AssetProcessingFailure {
  const safeMessage = message.replace(/[\r\n\t]+/gu, ' ').trim();
  const diagnostics = options.diagnostics === undefined
    ? undefined
    : Object.freeze({ ...options.diagnostics });

  return Object.freeze({
    category,
    stage,
    message: safeMessage || 'Asset processing failed.',
    retryable: options.retryable ?? defaultRetryability(category),
    ...(diagnostics === undefined ? {} : { diagnostics }),
    ...(options.occurredAt === undefined ? {} : { occurredAt: options.occurredAt }),
  });
}

function defaultRetryability(category: AssetProcessingFailureCategory): boolean {
  return category === 'STORAGE_ERROR'
    || category === 'PROCESSING_TIMEOUT'
    || category === 'DERIVATIVE_GENERATION_FAILED'
    || category === 'UNKNOWN_PROCESSING_ERROR';
}

