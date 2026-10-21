import {NativeModules} from 'react-native';

/** The event shared by live frames and selected-photo analysis. */
export type NativeVisionEvent = {
  id: string;
  ids: string[];
  confirmed: boolean;
  searched: boolean;
  inliers: number;
  coverage: number;
  processingMs: number;
  trackingMs: number;
  retrievalMs: number;
  verificationMs: number;
  ready: number;
  message: string;
  frames: number;
  cardsJson?: string;
  metadataRefresh?: boolean;
  similarity?: number;
  ocrMs?: number;
};
export type CompactFile = {path: string; sha256: string; bytes: number};
export type CompactFiles = {model: CompactFile; index: CompactFile; cards: CompactFile; prices: CompactFile};

type NativeVisionModule = {
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  setViewport(width: number, height: number): void;
  setEnabled(enabled: boolean): void;
  configure(paths: string[], ids: string[]): Promise<number>;
  configureCompact(files: CompactFiles, language: string): Promise<number>;
  verifyCompactPart(file: CompactFile): Promise<void>;
  analyzePhoto(path: string, width: number, height: number): Promise<NativeVisionEvent>;
};

export const nativeVision = NativeModules.TCGCardVision as NativeVisionModule;
export const NATIVE_VISION_EVENT = 'TCGCardVision';
