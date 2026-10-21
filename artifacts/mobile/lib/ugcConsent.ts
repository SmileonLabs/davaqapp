import AsyncStorage from "@react-native-async-storage/async-storage";
import { DAVAQ_COMMUNITY_RULES_VERSION } from "./davaqCommunityRules";

export type UgcConsentStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};
export type UgcConsentPromptState = {
  ownerId: string | null;
  visible: boolean;
  busy: boolean;
  error: string;
};
type Pending = { ownerId: string; promise: Promise<boolean>; resolve(value: boolean): void };
const idle = (): UgcConsentPromptState => ({ ownerId: null, visible: false, busy: false, error: "" });

export function ugcConsentStorageKey(ownerId: string, version = DAVAQ_COMMUNITY_RULES_VERSION) {
  return `davaq.ugc-consent.v1:${encodeURIComponent(ownerId)}:${encodeURIComponent(version)}`;
}
export function isUgcConsentRecord(raw: string | null, ownerId: string, version: string): boolean {
  try {
    const record = JSON.parse(raw ?? "null");
    return record?.ownerId === ownerId && record?.version === version &&
      record?.accepted === true && typeof record?.acceptedAt === "string" &&
      Number.isFinite(Date.parse(record.acceptedAt));
  } catch {
    return false;
  }
}

/** Device-local acknowledgement only. This is not a server-side consent record. */
export class UgcConsentController {
  private ownerId: string | null = null;
  private pending: Pending | null = null;
  private state = idle();
  private listeners = new Set<() => void>();
  constructor(
    private readonly storage: UgcConsentStorage = AsyncStorage,
    private readonly version = DAVAQ_COMMUNITY_RULES_VERSION,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(state: UgcConsentPromptState) {
    this.state = state;
    this.listeners.forEach(listener => listener());
  }
  private finish(pending: Pending, accepted: boolean) {
    if (this.pending !== pending) return;
    this.pending = null;
    this.update(idle());
    pending.resolve(accepted);
  }
  setOwner(ownerId: string | null | undefined) {
    const next = typeof ownerId === "string" && ownerId.trim() ? ownerId : null;
    if (this.ownerId === next) return;
    this.ownerId = next;
    if (this.pending) this.finish(this.pending, false);
  }
  /** Invoke from a foreground, user-initiated create/upload action only. */
  ensureConsent = (): Promise<boolean> => {
    const ownerId = this.ownerId;
    if (!ownerId) return Promise.resolve(false);
    if (this.pending) return this.pending.promise;
    let resolve!: (accepted: boolean) => void;
    const promise = new Promise<boolean>(done => { resolve = done; });
    const pending = { ownerId, promise, resolve };
    this.pending = pending;
    void (async () => {
      try {
        const raw = await this.storage.getItem(ugcConsentStorageKey(ownerId, this.version));
        if (this.pending !== pending) return;
        if (isUgcConsentRecord(raw, ownerId, this.version)) {
          this.finish(pending, true);
          return;
        }
        this.update({ ownerId, visible: true, busy: false, error: "" });
      } catch {
        if (this.pending === pending) this.update({ ownerId, visible: true, busy: false,
          error: "이 기기의 동의 상태를 확인하지 못했어요. 규칙을 확인한 뒤 다시 저장해 주세요." });
      }
    })();
    return promise;
  };
  accept = async (explicitlyChecked: boolean): Promise<void> => {
    const pending = this.pending;
    if (!pending || !explicitlyChecked || !this.state.visible || this.state.busy) return;
    this.update({ ...this.state, busy: true, error: "" });
    try {
      const key = ugcConsentStorageKey(pending.ownerId, this.version);
      await this.storage.setItem(key, JSON.stringify({ ownerId: pending.ownerId,
        version: this.version, accepted: true, acceptedAt: new Date().toISOString() }));
      // Do not claim success if the browser/storage silently dropped the write.
      const stored = await this.storage.getItem(key);
      if (!isUgcConsentRecord(stored, pending.ownerId, this.version)) throw new Error("consent_write_unverified");
      this.finish(pending, true);
    } catch {
      if (this.pending === pending) this.update({ ...this.state, busy: false,
        error: "동의를 이 기기에 저장하지 못했어요. 저장 공간과 브라우저 설정을 확인한 뒤 다시 시도해 주세요." });
    }
  };
  cancel = () => {
    if (this.pending && !this.state.busy) this.finish(this.pending, false);
  };
  dispose = () => {
    if (this.pending) this.finish(this.pending, false);
    this.listeners.clear();
  };
}
