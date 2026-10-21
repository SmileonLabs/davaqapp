export interface ChatReadingPosition {
  messageId: string;
  roomSeq: number;
  atLatest: boolean;
  savedAt: number;
}
type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
};
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
export function parseReadingPosition(
  raw: string | null,
  now = Date.now(),
): ChatReadingPosition | null {
  try {
    const p = JSON.parse(raw ?? "null");
    return p &&
      typeof p.messageId === "string" &&
      p.messageId.length > 0 &&
      p.messageId.length < 200 &&
      Number.isSafeInteger(p.roomSeq) &&
      p.roomSeq > 0 &&
      typeof p.atLatest === "boolean" &&
      Number.isFinite(p.savedAt) &&
      p.savedAt <= now + 60000 &&
      now - p.savedAt < MAX_AGE
      ? p
      : null;
  } catch {
    return null;
  }
}
export function createReadingPositionStore(storage: Storage) {
  const writes = new Map<string, Promise<unknown>>();
  const key = (scope: string) =>
    `davaq:chat-position:v1:${encodeURIComponent(scope)}`;
  return {
    async read(scope: string) {
      await writes.get(scope)?.catch(() => {});
      return parseReadingPosition(await storage.getItem(key(scope)));
    },
    write(scope: string, position: ChatReadingPosition) {
      const next = (writes.get(scope) ?? Promise.resolve())
        .catch(() => {})
        .then(() => storage.setItem(key(scope), JSON.stringify(position)));
      writes.set(scope, next);
      void next
        .finally(() => {
          if (writes.get(scope) === next) writes.delete(scope);
        })
        .catch(() => {});
      return next;
    },
  };
}
