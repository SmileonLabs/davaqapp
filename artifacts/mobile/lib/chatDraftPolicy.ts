type Storage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<unknown>;
  removeItem: (key: string) => Promise<unknown>;
};
/** Serial writes ensure a late autosave cannot resurrect a draft after sending. */
export function createChatDraftStore(storage: Storage) {
  const pending = new Map<string, Promise<unknown>>();
  const storageKey = (key: string) =>
    "davaq.chat-draft.v1:" + encodeURIComponent(key);
  return {
    async read(key: string) {
      await pending.get(key)?.catch(() => {});
      const value = await storage.getItem(storageKey(key));
      if (!value) return "";
      try {
        const parsed = JSON.parse(value);
        return typeof parsed.text === "string"
          ? parsed.text.slice(0, 10000)
          : "";
      } catch {
        return "";
      }
    },
    write(key: string, text: string) {
      const previous = pending.get(key) ?? Promise.resolve();
      const next = previous
        .catch(() => {})
        .then(() =>
          text
            ? storage.setItem(
                storageKey(key),
                JSON.stringify({ text: text.slice(0, 10000) }),
              )
            : storage.removeItem(storageKey(key)),
        );
      pending.set(key, next);
      void next
        .finally(() => {
          if (pending.get(key) === next) pending.delete(key);
        })
        .catch(() => {});
      return next;
    },
  };
}
