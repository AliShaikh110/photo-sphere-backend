import type { AssetDerivativeKind } from '@alishaikh110/experience-schema';

export type GeneratedStorageObject = {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  body: Buffer;
  metadata: Record<string, string>;
};

export type GeneratedDerivative = {
  kind: AssetDerivativeKind;
  version: number;
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  checksum: string;
  body: Buffer;
  metadata: Record<string, unknown>;
  /** Supporting immutable objects which must be stored before the parent object. */
  supportingObjects?: readonly GeneratedStorageObject[];
};
