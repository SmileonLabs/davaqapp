// Fence delayed preparation so accepting/cancelling a call cannot start a stale tone.
export function createToneController<T extends { play(): void }>(options: {
  prepare(): Promise<void>;
  create(asset: number): T;
  dispose(player: T): void;
  onError(error: unknown): void;
}) {
  let generation = 0;
  let player: T | null = null;
  function stop() {
    generation += 1;
    const previous = player;
    player = null;
    if (previous) options.dispose(previous);
  }
  return {
    stop,
    start(asset: number) {
      stop();
      const attempt = generation;
      void (async () => {
        try {
          await options.prepare();
          if (attempt !== generation) return;
          player = options.create(asset);
          player.play();
        } catch (error) {
          if (attempt !== generation) return;
          stop();
          options.onError(error);
        }
      })();
    },
  };
}
