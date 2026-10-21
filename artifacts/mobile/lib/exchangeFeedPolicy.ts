/** Keep a small image window warm; metadata stays available when swiping back. */
export const EXCHANGE_FEED_AHEAD = 3;
export const EXCHANGE_FEED_BEHIND = 1;
export const EXCHANGE_FEED_PAGE_LEAD = 40;
export const EXCHANGE_FEED_IMAGE_CONCURRENCY = 2;

export function uniqueExchangeItems<T extends { id: string }>(
  pages: readonly { items: readonly T[] }[],
): T[] {
  const seen = new Set<string>();
  return pages.flatMap((page) =>
    page.items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  );
}

export function selectExchangePhotos<T>(
  items: readonly T[],
  activeIndex: number,
  firstPhoto: (item: T) => string | undefined = (item) =>
    (item as { photos?: readonly string[] }).photos?.[0],
): string[] {
  if (!items.length) return [];
  const active = Math.max(
    0,
    Math.min(items.length - 1, Math.floor(activeIndex) || 0),
  );
  // Current image first, then the direction of travel, then one previous image.
  const indices = [
    active,
    ...Array.from({ length: EXCHANGE_FEED_AHEAD }, (_, i) => active + i + 1),
    active - EXCHANGE_FEED_BEHIND,
  ];
  return [
    ...new Set(
      indices.flatMap((index) => {
        const item = items[index];
        const photo = item ? firstPhoto(item) : undefined;
        return photo ? [photo] : [];
      }),
    ),
  ];
}

export function shouldPrefetchExchangePage(
  itemCount: number,
  activeIndex: number,
  hasNext: boolean,
  fetching: boolean,
) {
  return (
    hasNext &&
    !fetching &&
    itemCount > 0 &&
    itemCount - Math.max(0, activeIndex) - 1 <= EXCHANGE_FEED_PAGE_LEAD
  );
}

type Loader = (
  source: string,
  isCurrent: () => boolean,
) => Promise<boolean | void>;
type Job = {
  key: string;
  source: string;
  owner: string;
  epoch: number;
  load: Loader;
  priority: "active" | "warm";
};

/**
 * The latest swipe replaces queued work, while at most two existing downloads
 * finish. Failed images are eligible on the next swipe, without a retry loop.
 */
export class ExchangeImagePreloader {
  private owner?: string;
  private epoch = 0;
  private queue: Job[] = [];
  private running = new Set<string>();
  private completed = new Map<string, number>();
  private activeConsumers = new Map<symbol, string>();
  private allowed: () => boolean = () => false;
  private readonly concurrency: number;
  private readonly maxRemembered: number;
  private readonly now: () => number;

  constructor(
    concurrency = EXCHANGE_FEED_IMAGE_CONCURRENCY,
    maxRemembered = 80,
    now: () => number = Date.now,
  ) {
    this.concurrency = concurrency;
    this.maxRemembered = maxRemembered;
    this.now = now;
  }

  /** Visible feeds outrank delayed tab warmups, including an unresolved cold fetch. */
  claim(owner: string) {
    const token = Symbol(owner);
    this.activeConsumers.set(token, owner);
    return () => {
      this.activeConsumers.delete(token);
    };
  }

  private hasActiveConsumer(owner: string) {
    return [...this.activeConsumers.values()].includes(owner);
  }

  request(
    owner: string,
    sources: readonly string[],
    load: Loader,
    allowed: () => boolean,
    priority: "active" | "warm" = "active",
  ) {
    // Do not even replace allowed/owner: those belong to the visible viewport.
    if (priority === "warm" && this.hasActiveConsumer(owner)) return;
    if (this.owner !== owner) {
      this.owner = owner;
      this.epoch++;
      this.completed.clear();
    }
    this.allowed = allowed;
    if (!allowed()) {
      this.pause();
      return;
    }
    const epoch = this.epoch;
    this.queue = [...new Set(sources)].flatMap((source) => {
      const key = `${owner}:${source}`;
      const touched = this.completed.get(key);
      // Refresh the signed-URL/image window before media-url's four-minute TTL.
      if (touched !== undefined && this.now() - touched < 3 * 60_000) {
        this.completed.delete(key);
        this.completed.set(key, touched);
        return [];
      }
      return this.running.has(key)
        ? []
        : [{ key, source, owner, epoch, load, priority }];
    });
    this.pump();
  }

  pause() {
    this.epoch++;
    this.queue = [];
  }

  private pump() {
    if (!this.allowed()) {
      this.queue = [];
      return;
    }
    while (this.running.size < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      if (
        job.epoch !== this.epoch ||
        job.owner !== this.owner ||
        (job.priority === "warm" && this.hasActiveConsumer(job.owner))
      )
        continue;
      this.running.add(job.key);
      const current = () =>
        job.epoch === this.epoch && job.owner === this.owner && this.allowed();
      void Promise.resolve()
        .then(() => (current() ? job.load(job.source, current) : false))
        .then((success) => {
          if (success === false || !current()) return;
          this.completed.delete(job.key);
          this.completed.set(job.key, this.now());
          while (this.completed.size > this.maxRemembered)
            this.completed.delete(this.completed.keys().next().value!);
        })
        .catch(() => {
          /* Displaying the image owns the visible error/retry state. */
        })
        .finally(() => {
          this.running.delete(job.key);
          this.pump();
        });
    }
  }
}
