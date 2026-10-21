export type ScreenAwakeAdapter = {
  available(): Promise<boolean>;
  activate(tag: string): Promise<void>;
  deactivate(tag: string): Promise<void>;
};

export function shouldKeepCallScreenAwake(mode: string): boolean {
  return mode === 'outgoing' || mode === 'joining' || mode === 'active';
}

// Serialize transitions: a call ending while activation is pending must release
// the eventual lock; an old cleanup must never release a newer activation.
export function createCallScreenAwakeController(adapter: ScreenAwakeAdapter, tag: string) {
  let wanted = false;
  let held = false;
  let queue = Promise.resolve();
  return {
    setActive(active: boolean): Promise<void> {
      wanted = active;
      queue = queue.then(async () => {
        try {
          if (wanted && !held && await adapter.available() && wanted) {
            await adapter.activate(tag);
            held = true;
          }
          if (!wanted && held) {
            held = false;
            await adapter.deactivate(tag);
          }
        } catch {
          // Unsupported browsers, an inactive Android Activity, or a denied wake
          // lock must not reject the call's media/signaling lifecycle.
          held = false;
          await adapter.deactivate(tag).catch(() => {});
        }
      });
      return queue;
    },
  };
}
