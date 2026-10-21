import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  useInfiniteQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Image } from "expo-image";
import { useAuth } from "@/lib/davaqAuth";
import { resolveMediaUri } from "@/hooks/useMediaUri";
import {
  acquireBrowserPhoto,
  setBrowserMediaOwner,
} from "@/lib/chatBrowserMediaCache";
import {
  ExchangeImagePreloader,
  selectExchangePhotos,
  shouldPrefetchExchangePage,
  uniqueExchangeItems,
} from "@/lib/exchangeFeedPolicy";
import type { Listing } from "@/lib/tcg";
import {
  publicCardImageUri,
  selectPublicCardImageUris,
} from "@/lib/publicCardImagePolicy";
import {
  exchangeCardPhotos,
  preserveCardFeedWrites,
  type CardFeedPage,
  type FeedCard,
} from "@/lib/tcgCardFeed";
export type { FeedCard, CardFeedItem, CardFeedPage } from "@/lib/tcgCardFeed";

export type FeedListing = Listing & {
  offer_count: number;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  can_offer: boolean;
};
export type ExchangeFeedPage = CardFeedPage;
const STALE_TIME = 30_000;
const GC_TIME = 5 * 60_000;

export const exchangeFeedQueryKey = (
  userId: string | null | undefined,
  q = "",
  cardId = "",
) => ["davaq", userId, "exchange-card-feed", q, cardId] as const;

function feedOptions(userId: string | null | undefined, q = "", cardId = "") {
  return {
    queryKey: exchangeFeedQueryKey(userId, q, cardId),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({
      pageParam,
      signal,
    }: {
      pageParam: string | undefined;
      signal: AbortSignal;
    }): Promise<ExchangeFeedPage> => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (cardId) params.set("cardId", cardId);
      if (pageParam) params.set("cursor", pageParam);
      const suffix = params.toString();
      const page = await customFetch<ExchangeFeedPage>(
        `/api/tcg/card-feed${suffix ? `?${suffix}` : ""}`,
        { signal, timeoutMs: 25_000, responseType: "json" },
      );
      return {
        items: Array.isArray(page.items) ? page.items.filter(Boolean) : [],
        nextCursor:
          typeof page.nextCursor === "string" &&
          (page.nextCursor !== pageParam || page.catalogUnavailable === true)
            ? page.nextCursor
            : null,
        catalogUnavailable: page.catalogUnavailable === true,
      };
    },
    getNextPageParam: (lastPage: ExchangeFeedPage) =>
      lastPage.nextCursor ?? undefined,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    structuralSharing: preserveCardFeedWrites,
    retry: (failures: number, error: unknown) => {
      const status = (error as { status?: number } | null)?.status;
      return (!status || status >= 500) && failures < 1;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // The API has no previous cursor. Evicting a page would remove cards the
    // user can still swipe back to; only decoded image memory is bounded.
  };
}

function foreground() {
  return Platform.OS === "web"
    ? typeof document !== "undefined" && document.visibilityState === "visible"
    : AppState.currentState === "active";
}

/** Pauses speculative work only. The screen's authoritative query stays usable. */
function useCanPreload() {
  const [active, setActive] = useState(foreground);
  const [online, setOnline] = useState(
    Platform.OS === "web" && typeof navigator !== "undefined"
      ? navigator.onLine !== false
      : false,
  );
  useEffect(() => {
    if (Platform.OS === "web") {
      if (typeof window === "undefined") return;
      const visibility = () => setActive(foreground());
      const network = () => setOnline(navigator.onLine !== false);
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("online", network);
      window.addEventListener("offline", network);
      return () => {
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("online", network);
        window.removeEventListener("offline", network);
      };
    }
    const subscription = AppState.addEventListener("change", () =>
      setActive(foreground()),
    );
    const unsubscribe = NetInfo.addEventListener((state) =>
      setOnline(
        state.isConnected !== false && state.isInternetReachable !== false,
      ),
    );
    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, []);
  return active && online;
}

/** Same stable source used by CardArt, so preloading prepares a real cache hit. */
export function exchangeFeedImageSource(source?: string | null) {
  return publicCardImageUri(source);
}

const publicHomePreloader = new ExchangeImagePreloader();
export function preloadPublicCardImages(
  sources: readonly (string | null | undefined)[],
  allowed: () => boolean = () => true,
) {
  publicHomePreloader.request(
    "public-catalog-home",
    selectPublicCardImageUris(sources),
    async (uri, current) =>
      current() ? Image.prefetch(uri, { cachePolicy: "memory-disk" }) : false,
    allowed,
    "warm",
  );
}

const preloaders = new WeakMap<QueryClient, ExchangeImagePreloader>();
function mediaPreloader(client: QueryClient) {
  let preloader = preloaders.get(client);
  if (!preloader) {
    preloader = new ExchangeImagePreloader();
    preloaders.set(client, preloader);
  }
  return preloader;
}

async function warmImage(
  client: QueryClient,
  owner: string,
  source: string,
  current: () => boolean,
) {
  if (!current()) return false;
  const src = exchangeFeedImageSource(source)!;
  const resolve = () => {
    if (!current()) return Promise.reject(new Error("exchange-preload-paused"));
    return src.startsWith("/objects/")
      ? client.fetchQuery({
          queryKey: ["media-url", src],
          queryFn: () => resolveMediaUri(src),
          staleTime: 4 * 60_000,
          gcTime: 5 * 60_000,
          retry: 1,
        })
      : Promise.resolve(src);
  };
  if (Platform.OS === "web" && src.startsWith("/objects/")) {
    if (!current()) return false;
    setBrowserMediaOwner(owner);
    const image = await acquireBrowserPhoto(owner, src, resolve);
    image.release();
    return true;
  }
  const uri = await resolve();
  if (!current()) return false;
  return Image.prefetch(uri, { cachePolicy: "memory-disk" });
}

export function useExchangeFeed(
  q = "",
  cardId = "",
  enabled = true,
  activeIndex = 0,
) {
  const { userId, isSignedIn } = useAuth();
  const canPreload = useCanPreload();
  const query = useInfiniteQuery({
    ...feedOptions(userId, q, cardId),
    enabled: enabled && !!isSignedIn && !!userId,
  });
  const items = useMemo(
    () => uniqueExchangeItems(query.data?.pages ?? []),
    [query.data],
  );
  const catalogUnavailable =
    query.data?.pages.at(-1)?.catalogUnavailable === true;
  const lastAttempt = useRef("");
  useEffect(() => {
    if (!canPreload || !enabled || !isSignedIn) {
      lastAttempt.current = "";
      return;
    }
    if (
      (query.error as { status?: number } | null)?.status === 410 ||
      catalogUnavailable
    )
      return;
    const continueEmptyPage =
      items.length === 0 &&
      (query.data?.pages.length ?? 0) < 3 &&
      query.hasNextPage &&
      !query.isFetching;
    if (
      !continueEmptyPage &&
      !shouldPrefetchExchangePage(
        items.length,
        activeIndex,
        query.hasNextPage,
        query.isFetching,
      )
    )
      return;
    const cursor = query.data?.pages.at(-1)?.nextCursor;
    const attempt = JSON.stringify([userId, q, cardId, cursor, activeIndex]);
    if (lastAttempt.current === attempt) return;
    lastAttempt.current = attempt;
    void query.fetchNextPage({ cancelRefetch: false }).catch(() => {});
  }, [
    canPreload,
    enabled,
    isSignedIn,
    userId,
    q,
    cardId,
    activeIndex,
    items.length,
    query.data,
    query.hasNextPage,
    query.isFetching,
    query.error,
    query.fetchNextPage,
    catalogUnavailable,
  ]);
  return { ...query, items, catalogUnavailable };
}

export function useExchangeFeedPreload(
  items: readonly FeedCard[],
  activeIndex: number,
  enabled = true,
) {
  const client = useQueryClient();
  const { userId, isSignedIn } = useAuth();
  const canPreload = useCanPreload();
  const allowed = useRef(false);
  allowed.current = enabled && !!isSignedIn && !!userId && canPreload;
  const photos = useMemo(
    () =>
      selectExchangePhotos(
        items,
        activeIndex,
        (item) => exchangeCardPhotos(item)[0],
      ),
    [items, activeIndex],
  );
  useEffect(() => {
    if (!enabled || !isSignedIn || !userId) return;
    return mediaPreloader(client).claim(userId);
  }, [client, userId, isSignedIn, enabled]);
  useEffect(() => {
    const preloader = mediaPreloader(client);
    if (!allowed.current || !userId) {
      preloader.pause();
      return;
    }
    preloader.request(
      userId,
      photos,
      (source, current) => warmImage(client, userId, source, current),
      () => allowed.current,
    );
  }, [client, userId, isSignedIn, enabled, canPreload, photos]);
  useEffect(
    () => () => {
      allowed.current = false;
    },
    [client],
  );
}

/** Authenticated tab layout calls this once; entering the feed reuses its page. */
export function useWarmExchangeFeed() {
  const client = useQueryClient();
  const { userId, isSignedIn } = useAuth();
  const canPreload = useCanPreload();
  useEffect(() => {
    if (!canPreload || !isSignedIn || !userId) return;
    let current = true;
    const allowed = () =>
      current &&
      foreground() &&
      (Platform.OS !== "web" || navigator.onLine !== false);
    const options = feedOptions(userId);
    // Never refetch all pages of an already-open feed just to warm the tab.
    const cached = client.getQueryData<{ pages: ExchangeFeedPage[] }>(
      options.queryKey,
    );
    const prepare = async () => {
      if (!cached) await client.prefetchInfiniteQuery({ ...options, pages: 1 });
      if (!allowed()) return;
      const data = client.getQueryData<{ pages: ExchangeFeedPage[] }>(
        options.queryKey,
      );
      const photos = (data?.pages[0]?.items ?? [])
        .slice(0, 3)
        .flatMap((item) => exchangeCardPhotos(item).slice(0, 1));
      mediaPreloader(client).request(
        userId,
        photos,
        (source, isCurrent) => warmImage(client, userId, source, isCurrent),
        allowed,
        "warm",
      );
    };
    void prepare().catch(() => {});
    return () => {
      current = false;
    };
  }, [client, canPreload, isSignedIn, userId]);
}
