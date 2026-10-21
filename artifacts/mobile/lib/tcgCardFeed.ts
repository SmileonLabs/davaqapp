import type { CatalogCard, Listing } from "./tcg";

/** Cards are browsable even when no collector has published an offer for them. */
export type FeedCard = {
  id: string;
  card: CatalogCard;
  available_listing_count: number;
  available_listings: Listing[];
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  owned_by_me: boolean;
};

export type CardFeedItem = FeedCard;
export type CardFeedPage = {
  items: FeedCard[];
  nextCursor: string | null;
  /** A partial page remains visible; only an explicit retry resumes the source. */
  catalogUnavailable?: boolean;
};

/** Display and background warming must resolve the same representative image. */
export function exchangeCardPhotos(item: FeedCard): string[] {
  if (item.card.imageSrc) return [item.card.imageSrc];
  return (
    item.available_listings.find((listing) => listing.photos.length)?.photos ??
    []
  );
}

export const cardFeedPath = (cardId: string) =>
  `/tcg/cards/${encodeURIComponent(cardId)}`;

type FeedCache = {
  pages: { nextCursor?: string | null }[];
  pageParams: unknown[];
};
const feedCache = (value: unknown): value is FeedCache =>
  !!value &&
  typeof value === "object" &&
  Array.isArray((value as FeedCache).pages) &&
  Array.isArray((value as FeedCache).pageParams);

/**
 * Infinite queries capture the earlier pages before a next-page request.
 * Keep confirmed like/comment writes made to those pages while it was pending.
 * A refetch or a new shuffled snapshot remains authoritative.
 */
export function preserveCardFeedWrites(
  previous: unknown,
  incoming: unknown,
): unknown {
  if (
    !feedCache(previous) ||
    !feedCache(incoming) ||
    !previous.pages.length ||
    incoming.pages.length <= previous.pages.length
  )
    return incoming;
  const firstCursor = previous.pages[0].nextCursor;
  if (!firstCursor || firstCursor !== incoming.pages[0]?.nextCursor)
    return incoming;
  if (
    previous.pageParams.some(
      (param, index) => param !== incoming.pageParams[index],
    )
  )
    return incoming;
  return {
    ...incoming,
    pages: [...previous.pages, ...incoming.pages.slice(previous.pages.length)],
  };
}
