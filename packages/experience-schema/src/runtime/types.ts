export const RUNTIME_DEVICE_CLASSES = ['constrained', 'standard', 'capable'] as const;
export type RuntimeDeviceClass = (typeof RUNTIME_DEVICE_CLASSES)[number];

export const RUNTIME_NETWORK_CLASSES = [
  'offline',
  'constrained',
  'standard',
  'fast',
] as const;
export type RuntimeNetworkClass = (typeof RUNTIME_NETWORK_CLASSES)[number];

/**
 * Scene transition failure categories are part of the shared telemetry
 * contract; they are re-exported here so runtime policy code keeps one import.
 */
export {
  SCENE_TRANSITION_FAILURE_CATEGORIES,
} from '@sphere/telemetry-contract';
export type { SceneTransitionFailureCategory } from '@sphere/telemetry-contract';
