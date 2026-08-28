export const RUNTIME_DEVICE_CLASSES = ['constrained', 'standard', 'capable'] as const;
export type RuntimeDeviceClass = (typeof RUNTIME_DEVICE_CLASSES)[number];

export const RUNTIME_NETWORK_CLASSES = [
  'offline',
  'constrained',
  'standard',
  'fast',
] as const;
export type RuntimeNetworkClass = (typeof RUNTIME_NETWORK_CLASSES)[number];

/** Stable, product-level categories accepted by scene transition telemetry. */
export const SCENE_TRANSITION_FAILURE_CATEGORIES = [
  'scene_definition_unavailable',
  'scene_definition_invalid',
  'asset_unavailable',
  'asset_decode_failed',
  'unsupported_media',
  'viewer_error',
  'transition_timeout',
  'unknown',
] as const;
export type SceneTransitionFailureCategory =
  (typeof SCENE_TRANSITION_FAILURE_CATEGORIES)[number];
