import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { useAuth } from "@/lib/davaqAuth";
import { usePwaBottomInset } from "@/hooks/usePwaBottomInset";
import { useMediaResource } from "@/hooks/useMediaUri";
import { useBrowserChatPhoto } from "@/hooks/useBrowserChatPhoto";
import {
  useExchangeFeed,
  useExchangeFeedPreload,
  exchangeFeedQueryKey,
} from "@/hooks/useExchangeFeed";
import { ExchangeIcon as Icon, type ExchangeIconName } from "./ExchangeIcon";
import { C, S, Txt, Button, Empty, Field, Notice } from "@/components/davaq/UI";
import {
  api,
  cardLink,
  conditionName,
  errorText,
  key,
  type Listing,
  type Owned,
  type Page,
} from "@/lib/tcg";
import { CardArt } from "./Cards";
import { ContentReportSheet } from "@/components/ContentReportSheet";
import { useUgcConsent, UgcConsentPrompt } from "@/components/UgcConsentPrompt";
import { Feather } from "@expo/vector-icons";
import type { ContentReportTarget } from "@/lib/contentReports";
import {
  cardFeedPath,
  exchangeCardPhotos,
  preserveCardFeedWrites,
  type CardFeedItem,
  type CardFeedPage,
} from "@/lib/tcgCardFeed";
import { registrationId } from "@/lib/tcgRegistration";
import {
  publicCardImageSources,
  CARD_IMAGE_ATTEMPT_TIMEOUT_MS,
} from "@/lib/publicCardImagePolicy";

type FeedPage = CardFeedPage;
type Comment = {
  id: string;
  owner_id: string;
  owner_name: string;
  body: string;
  created_at: string;
};
type Sheet =
  | { kind: "offers"; card: CardFeedItem }
  | { kind: "comments"; card: CardFeedItem }
  | { kind: "register"; card: CardFeedItem }
  | {
      kind: "offer";
      listing: Listing;
      card?: CardFeedItem;
      offeredListingId?: string;
    };
const listingKey = (card: CardFeedItem) => card.id;
const layoutItem = (_: unknown, index: number, height: number) => ({
  length: height,
  offset: height * index,
  index,
});
const modeLabel = (l: Listing) =>
  l.mode === "gift"
    ? "무료 나눔"
    : l.wanted_card_ids.length
      ? "바로 교환"
      : "제안 받기";
const actionLabel = (l: Listing) =>
  l.mode === "gift"
    ? "나눔 신청하기"
    : l.wanted_card_ids.length
      ? "교환 요청하기"
      : "내 카드로 제안하기";

/** One scroll owner, measured pages, and a small render window keep gestures off the data path. */
export function ExchangeFeedScreen() {
  const router = useRouter();
  const {
    cardId = "",
    offerListing,
    offeredListing,
    published,
  } = useLocalSearchParams<{
    cardId?: string;
    offerListing?: string;
    offeredListing?: string;
    published?: string;
  }>();
  const insets = useSafeAreaInsets();
  const pwaInset = usePwaBottomInset();
  const me = useGetMe();
  const { userId } = useAuth();
  const client = useQueryClient();
  const returnTarget = registrationId(offerListing);
  const returnOwn = registrationId(offeredListing);
  const publishedId = registrationId(published);
  const handledReturn = useRef("");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [height, setHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const returnListing = useQuery({
    queryKey: ["davaq", userId, "/tcg/listings/" + returnTarget],
    queryFn: () => api<Listing>("/tcg/listings/" + returnTarget),
    enabled: focused && !!returnTarget && !!userId,
    staleTime: 0,
    retry: false,
  });
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [publishedNotice, setPublishedNotice] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const list = useRef<FlatList<CardFeedItem>>(null);
  const scrollIndex = useRef(0);
  const activeId = useRef<string | undefined>(undefined);
  const query = useExchangeFeed(search, cardId, focused, activeIndex);
  const pageExpired =
    (query.error as { status?: number } | null)?.status === 410;
  useExchangeFeedPreload(query.items, activeIndex, focused && !sheet);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const patchCard = useCallback(
    (id: string, patch: Partial<CardFeedItem>) => {
      client.setQueriesData<InfiniteData<FeedPage>>(
        { queryKey: exchangeFeedQueryKey(userId).slice(0, 3) },
        (old) =>
          old && {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                item.id === id ? { ...item, ...patch } : item,
              ),
            })),
          },
      );
    },
    [client, userId],
  );
  const like = useCallback(
    async (item: CardFeedItem, liked: boolean) => {
      const result = await api<{ liked_by_me: boolean; like_count: number }>(
        `${cardFeedPath(item.id)}/like`,
        "PUT",
        { liked },
      );
      patchCard(item.id, result);
      return result;
    },
    [patchCard],
  );
  const showOffers = useCallback(
    (card: CardFeedItem) => setSheet({ kind: "offers", card }),
    [],
  );
  const showComments = useCallback(
    (card: CardFeedItem) => setSheet({ kind: "comments", card }),
    [],
  );
  const showRegistration = useCallback(
    (card: CardFeedItem) => setSheet({ kind: "register", card }),
    [],
  );
  const openDetail = useCallback(
    (card: CardFeedItem) =>
      router.push(cardLink(card.card.saveId, card.card.title)),
    [router],
  );
  const renderItem = useCallback(
    ({ item }: { item: CardFeedItem }) => (
      <FeedSlide
        card={item}
        height={height}
        topInset={Platform.OS === "web" ? 12 : insets.top + 12}
        bottomInset={72 + (Platform.OS === "web" ? pwaInset : insets.bottom)}
        onLike={like}
        onOffers={showOffers}
        onRegister={showRegistration}
        onComments={showComments}
        onDetail={openDetail}
      />
    ),
    [
      height,
      like,
      showOffers,
      showRegistration,
      showComments,
      openDetail,
      insets.top,
      insets.bottom,
      pwaInset,
    ],
  );
  const getItemLayout = useCallback(
    (_: unknown, index: number) => layoutItem(_, index, height),
    [height],
  );
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!height) return;
      const next = Math.max(
        0,
        Math.round(event.nativeEvent.contentOffset.y / height),
      );
      activeId.current = query.items[next]?.id;
      if (scrollIndex.current !== next) {
        scrollIndex.current = next;
        setActiveIndex(next);
      }
    },
    [height, query.items],
  );
  useEffect(() => {
    activeId.current = undefined;
    scrollIndex.current = 0;
    setActiveIndex(0);
    setSheet(null);
    setNotice("");
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [search, cardId, userId]);
  useEffect(() => {
    const next = activeId.current
      ? query.items.findIndex((item) => item.id === activeId.current)
      : -1;
    if (next >= 0 && next !== scrollIndex.current) {
      scrollIndex.current = next;
      setActiveIndex(next);
      list.current?.scrollToOffset({ offset: next * height, animated: false });
    }
  }, [query.items, height]);
  // Rotation changes page geometry, not which card the user is viewing.
  useEffect(() => {
    if (height)
      list.current?.scrollToOffset({
        offset: scrollIndex.current * height,
        animated: false,
      });
  }, [height]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setNotice("");
    const feedKey = exchangeFeedQueryKey(userId, search, cardId);
    const previous = client.getQueryData<InfiniteData<FeedPage>>(feedKey);
    const previousIndex = scrollIndex.current;
    const previousId = activeId.current;
    try {
      // A new feed gets a fresh ranking snapshot; never silently reorder a card under a swipe.
      client.setQueriesData<InfiniteData<FeedPage>>(
        {
          queryKey: exchangeFeedQueryKey(userId, search, cardId),
          exact: true,
        },
        (old) =>
          old && {
            ...old,
            pages: old.pages.slice(0, 1),
            pageParams: old.pageParams.slice(0, 1),
          },
      );
      await query.refetch({ throwOnError: true });
      activeId.current = undefined;
      scrollIndex.current = 0;
      setActiveIndex(0);
      list.current?.scrollToOffset({ offset: 0, animated: false });
    } catch (error) {
      if (previous) {
        activeId.current = previousId;
        scrollIndex.current = previousIndex;
        setActiveIndex(previousIndex);
        client.setQueryData(feedKey, previous);
        list.current?.scrollToOffset({
          offset: previousIndex * height,
          animated: false,
        });
      }
      setNotice(errorText(error));
    } finally {
      setRefreshing(false);
    }
  }, [client, userId, search, cardId, height, query.refetch]);
  const top = Platform.OS === "web" ? 12 : insets.top + 12;
  useEffect(() => {
    if (!publishedNotice) return;
    const timer = setTimeout(() => setPublishedNotice(false), 3500);
    return () => clearTimeout(timer);
  }, [publishedNotice]);
  useEffect(() => {
    if (notice) setPublishedNotice(false);
  }, [notice]);
  useEffect(() => {
    if (!focused || !userId) return;
    if (!publishedId && !returnTarget) {
      handledReturn.current = "";
      return;
    }
    if (publishedId) {
      if (search) {
        setDraft("");
        setSearch("");
        return;
      }
      if (cardId) {
        router.setParams({ cardId: undefined });
        return;
      }
      const token = userId + ":published:" + publishedId;
      if (handledReturn.current === token) return;
      handledReturn.current = token;
      void refresh();
      setPublishedNotice(true);
      router.setParams({ published: undefined });
    } else if (
      returnTarget &&
      !returnListing.isFetching &&
      (returnListing.data || returnListing.isError)
    ) {
      const token = userId + ":offer:" + returnTarget + ":" + returnOwn;
      if (handledReturn.current === token) return;
      handledReturn.current = token;
      const listing = returnListing.data;
      if (
        listing?.status === "active" &&
        listing.available > 0 &&
        listing.owner_id !== me.data?.id
      ) {
        setSheet({
          kind: "offer",
          listing,
          card: query.items.find((item) => item.id === listing.card_id),
          offeredListingId: returnOwn,
        });
      } else {
        setNotice(
          returnListing.isError
            ? "카드 공개는 완료됐지만 원래 카드를 불러오지 못했어요. 피드에서 다시 선택해 주세요."
            : "카드 공개는 완료됐어요. 원래 카드는 현재 거래할 수 없어 다른 카드를 둘러봐 주세요.",
        );
      }
      router.setParams({ offerListing: undefined, offeredListing: undefined });
    }
  }, [
    focused,
    userId,
    publishedId,
    search,
    cardId,
    returnTarget,
    returnOwn,
    returnListing.data,
    returnListing.isFetching,
    returnListing.isError,
    me.data?.id,
    refresh,
    router,
  ]);
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      {focused && (
        <StatusBar style="light" backgroundColor="transparent" translucent />
      )}
      <View style={styles.content}>
        <View style={[styles.header, { top }]} pointerEvents="box-none">
          <Txt size={25} bold color="#FFFFFF" style={styles.overlayText}>
            교환
          </Txt>
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="교환 지도 보기"
            style={styles.headerIcon}
            onPress={() => router.push("/tcg/market?view=map" as any)}
          >
            <Icon name="map" color="#FFFFFF" size={23} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="카드 검색 열기"
            accessibilityState={{ expanded: searchVisible }}
            style={styles.headerIcon}
            onPress={() => setSearchVisible((value) => !value)}
          >
            <Icon
              name={searchVisible ? "x" : "search"}
              color="#FFFFFF"
              size={23}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="교환 카드 등록"
            style={styles.registerButton}
            onPress={() => router.push("/tcg/sell" as any)}
          >
            <Icon name="plus" color="#17151F" size={25} />
          </Pressable>
        </View>
        {searchVisible && (
          <View style={[styles.search, { top: top + 58 }]}>
            <View style={{ flex: 1 }}>
              <Field
                label="카드 검색"
                accessibilityLabel="교환 피드 검색"
                placeholder="찾는 카드를 검색하세요"
                value={draft}
                onChangeText={setDraft}
                returnKeyType="search"
                onSubmitEditing={() => {
                  setSearch(draft.trim());
                  setSearchVisible(false);
                }}
                style={{ minHeight: 42, paddingVertical: 8 }}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="검색 적용"
              style={styles.iconButton}
              onPress={() => {
                setSearch(draft.trim());
                setSearchVisible(false);
              }}
            >
              <Icon name="search" color={C.ink} />
            </Pressable>
          </View>
        )}
        {!!search && !searchVisible && (
          <View style={[styles.filterChip, { top: top + 58 }]}>
            <Txt size={12} color="#FFFFFF" lines={1}>
              {search}
            </Txt>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="검색 지우기"
              style={{ padding: 8 }}
              onPress={() => {
                setDraft("");
                setSearch("");
              }}
            >
              <Icon name="x" size={17} color="#FFFFFF" />
            </Pressable>
          </View>
        )}
        {!!notice && (
          <View style={[styles.notice, { top: top + 64 }]}>
            <Notice error>{notice}</Notice>
          </View>
        )}
        {publishedNotice && (
          <View pointerEvents="none" style={[styles.notice, { top: top + 64 }]}>
            <Notice>
              카드를 공개했어요. 교환 피드에서 바로 확인할 수 있어요.
            </Notice>
          </View>
        )}
        <View
          style={styles.feed}
          onLayout={(event) => {
            const next = Math.round(event.nativeEvent.layout.height);
            if (next > 0) setHeight(next);
          }}
        >
          {height > 0 && (
            <FlatList
              ref={list}
              data={query.items}
              renderItem={renderItem}
              keyExtractor={listingKey}
              getItemLayout={getItemLayout}
              pagingEnabled={Platform.OS !== "web"}
              snapToInterval={height}
              snapToAlignment="start"
              decelerationRate="fast"
              disableIntervalMomentum
              scrollEventThrottle={32}
              onScroll={onScroll}
              initialNumToRender={3}
              maxToRenderPerBatch={3}
              updateCellsBatchingPeriod={32}
              windowSize={5}
              removeClippedSubviews={false}
              showsVerticalScrollIndicator={false}
              style={[
                styles.list,
                Platform.OS === "web" &&
                  ({
                    scrollSnapType: "y mandatory",
                    overscrollBehaviorY: "contain",
                  } as any),
              ]}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => void refresh()}
                  tintColor={C.purple}
                />
              }
              ListEmptyComponent={
                <View style={{ height, justifyContent: "center", padding: 20 }}>
                  {query.isPending ? (
                    <View style={{ alignItems: "center", gap: 12 }}>
                      <ActivityIndicator color="#FFFFFF" />
                      <Txt color="#FFFFFF">교환 카드를 준비하고 있어요</Txt>
                    </View>
                  ) : query.isError ? (
                    <Empty
                      title="카드를 불러오지 못했어요"
                      body={errorText(query.error)}
                      action="다시 시도"
                      onPress={() => void refresh()}
                    />
                  ) : query.catalogUnavailable ? (
                    <Empty
                      title="카드 정보를 잠시 불러오지 못했어요"
                      body="이미 본 카드는 그대로 둘러볼 수 있어요. 잠시 후 다시 불러와 주세요."
                      action="다시 불러오기"
                      onPress={() => void query.fetchNextPage()}
                    />
                  ) : query.hasNextPage ? (
                    <View style={{ gap: 16, alignItems: "center" }}>
                      {query.isFetchingNextPage && (
                        <ActivityIndicator color="#FFFFFF" />
                      )}
                      <Empty
                        title="다음 카드도 이어서 확인할 수 있어요"
                        body="아직 불러올 카드가 남아 있어요. 계속 둘러보세요."
                        action={
                          query.isFetchingNextPage
                            ? undefined
                            : "카드 계속 불러오기"
                        }
                        onPress={() => {
                          if (!query.isFetchingNextPage)
                            void query.fetchNextPage();
                        }}
                      />
                    </View>
                  ) : (
                    <View
                      style={{
                        alignItems: "center",
                        gap: 18,
                        paddingHorizontal: 12,
                      }}
                    >
                      <Icon name="layers" size={44} color="#D8D3E6" />
                      <Txt
                        bold
                        size={22}
                        color="#FFFFFF"
                        style={{ textAlign: "center" }}
                      >
                        {search || cardId
                          ? "조건에 맞는 카드를 찾지 못했어요"
                          : "지금은 보여 드릴 카드가 없어요"}
                      </Txt>
                      <Txt
                        size={14}
                        color="#D8D3E6"
                        style={{ textAlign: "center" }}
                      >
                        내 카드를 등록하지 않아도 둘러볼 수 있어요.{"\n"}
                        검색 조건을 바꾸거나 전체 카드를 확인해 보세요.
                      </Txt>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="전체 카드 구경하기"
                        onPress={() => router.push("/tcg/catalog" as any)}
                        style={({ pressed }) => ({
                          minHeight: 52,
                          paddingHorizontal: 24,
                          paddingVertical: 15,
                          borderRadius: 16,
                          backgroundColor: "#FFFFFF",
                          opacity: pressed ? 0.85 : 1,
                        })}
                      >
                        <Txt bold color="#19151F">
                          전체 카드 구경하기
                        </Txt>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="내 카드 올리기"
                        onPress={() => router.push("/tcg/sell" as any)}
                        style={{ padding: 14 }}
                      >
                        <Txt bold color="#FFFFFF">
                          내 카드 올리기
                        </Txt>
                      </Pressable>
                    </View>
                  )}
                </View>
              }
              ListFooterComponent={
                query.items.length ? (
                  <View style={[styles.footer, { height }]}>
                    {query.isFetchingNextPage ? (
                      <ActivityIndicator color={C.purple} />
                    ) : query.catalogUnavailable ? (
                      <Empty
                        title="다음 카드 정보를 잠시 불러오지 못했어요"
                        body="앞서 본 카드와 오퍼는 그대로 볼 수 있어요."
                        action="카드 다시 불러오기"
                        onPress={() => void query.fetchNextPage()}
                      />
                    ) : query.isFetchNextPageError ? (
                      <Empty
                        title={
                          pageExpired
                            ? "새 카드가 있는지 확인해 볼까요?"
                            : "다음 카드를 불러오지 못했어요"
                        }
                        body="앞서 본 카드는 계속 볼 수 있어요."
                        action={pageExpired ? "새 카드 보기" : "다시 불러오기"}
                        onPress={() =>
                          pageExpired
                            ? void refresh()
                            : void query.fetchNextPage()
                        }
                      />
                    ) : query.hasNextPage ? (
                      <Empty
                        title="다음 카드도 둘러볼까요?"
                        body="다음 카드도 계속 구경해 보세요."
                        action="다음 카드 더 보기"
                        onPress={() => void query.fetchNextPage()}
                      />
                    ) : (
                      <Empty
                        title="여기까지 둘러봤어요"
                        body="새 카드가 있는지 확인하거나 내 카드를 올려 보세요."
                        action="새 카드 보기"
                        onPress={() => void refresh()}
                      />
                    )}
                  </View>
                ) : null
              }
            />
          )}
        </View>
      </View>
      {sheet && (
        <ExchangeSheet
          key={
            sheet.kind +
            (sheet.kind === "offer" ? sheet.listing.id : sheet.card.id)
          }
          sheet={sheet}
          onClose={() => setSheet(null)}
          onChoose={(listing, card) =>
            setSheet({ kind: "offer", listing, card })
          }
          onRegister={(card) => setSheet({ kind: "register", card })}
          onBack={(card) => setSheet({ kind: "offers", card })}
          patchCard={patchCard}
        />
      )}
    </View>
  );
}

const FeedSlide = memo(function FeedSlide({
  card: c,
  height,
  topInset,
  bottomInset,
  onLike,
  onOffers,
  onRegister,
  onComments,
  onDetail,
}: {
  card: CardFeedItem;
  height: number;
  topInset: number;
  bottomInset: number;
  onLike: (
    card: CardFeedItem,
    liked: boolean,
  ) => Promise<{ liked_by_me: boolean; like_count: number }>;
  onOffers: (card: CardFeedItem) => void;
  onRegister: (card: CardFeedItem) => void;
  onComments: (card: CardFeedItem) => void;
  onDetail: (card: CardFeedItem) => void;
}) {
  const [likeOverride, setLikeOverride] = useState<{
    liked_by_me: boolean;
    like_count: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [photo, setPhoto] = useState(0);
  const social = likeOverride ?? c;
  const photos = exchangeCardPhotos(c);
  const offerCount = Math.max(0, c.available_listing_count || 0);
  const hasOffers = offerCount > 0;
  const canRegister = c.card.saveAllowed !== false;
  const compact = height < 700;
  const short = height < 540;
  useEffect(() => setLikeOverride(null), [c.id, c.liked_by_me, c.like_count]);
  useEffect(() => setPhoto(0), [c.id, photos.join("\n")]);
  const toggleLike = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    if (Platform.OS !== "web") void Haptics.selectionAsync().catch(() => {});
    const before = {
      liked_by_me: social.liked_by_me,
      like_count: social.like_count,
    };
    setLikeOverride({
      liked_by_me: !social.liked_by_me,
      like_count: Math.max(
        0,
        social.like_count + (social.liked_by_me ? -1 : 1),
      ),
    });
    try {
      setLikeOverride(await onLike(c, !social.liked_by_me));
    } catch (e) {
      setLikeOverride(before);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    const url = `https://davaq.app/app/search?cardId=${encodeURIComponent(c.id)}`;
    setError("");
    setMessage("");
    try {
      if (Platform.OS === "web") {
        if (navigator.share)
          await navigator.share({ title: c.card.title, url });
        else {
          await navigator.clipboard.writeText(url);
          setMessage("링크를 복사했어요");
        }
      } else
        await Share.share({
          title: c.card.title,
          message: `${c.card.title}\n${url}`,
          url,
        });
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError")
        setError("공유를 열지 못했어요. 다시 시도해 주세요.");
    }
  };
  return (
    <View
      style={[
        styles.slide,
        { height },
        Platform.OS === "web" &&
          ({ scrollSnapAlign: "start", scrollSnapStop: "always" } as any),
      ]}
    >
      <FeedArt
        key={c.id + ":" + (photos[photo] ?? photos[0] ?? "empty")}
        src={photos[photo] ?? photos[0]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(5,6,14,0.70)", "rgba(5,6,14,0)"]}
        style={[styles.topGradient, { height: topInset + 140 }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(5,6,14,0)", "rgba(5,6,14,0.60)", "rgba(5,6,14,0.96)"]}
        locations={[0, 0.48, 1]}
        style={[
          styles.bottomGradient,
          { height: Math.max(330, height * 0.57) },
        ]}
      />
      {photos.length > 1 && (
        <View
          style={[
            styles.photoNavigation,
            short ? { bottom: bottomInset + 82 } : { top: topInset + 64 },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="이전 카드 사진"
            style={styles.photoButton}
            onPress={() =>
              setPhoto((i) => (i + photos.length - 1) % photos.length)
            }
          >
            <Icon name="chevron-left" size={20} color="#FFFFFF" />
          </Pressable>
          <Txt size={12} color="#FFFFFF" bold>
            {Math.min(photo + 1, photos.length)} / {photos.length}
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="다음 카드 사진"
            style={styles.photoButton}
            onPress={() => setPhoto((i) => (i + 1) % photos.length)}
          >
            <Icon name="chevron-right" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      )}
      <View
        style={[
          styles.social,
          compact && { gap: 8 },
          short
            ? {
                top: topInset + 60,
                bottom: undefined,
                flexDirection: "row",
                gap: 8,
              }
            : { bottom: bottomInset + 112 },
        ]}
      >
        <FeedAction
          compact={compact}
          icon="heart"
          label={String(social.like_count || 0)}
          accessibilityLabel={social.liked_by_me ? "좋아요 취소" : "좋아요"}
          selected={social.liked_by_me}
          disabled={busy}
          onPress={() => void toggleLike()}
        />
        <FeedAction
          compact={compact}
          icon="message-circle"
          label={String(c.comment_count || 0)}
          accessibilityLabel="카드 댓글 보기"
          onPress={() => onComments(c)}
        />
        <FeedAction
          compact={compact}
          icon="share"
          label="공유"
          accessibilityLabel="카드 공유"
          onPress={() => void share()}
        />
        <FeedAction
          compact={compact}
          icon="more-horizontal"
          label="정보"
          accessibilityLabel="카드 정보 보기"
          onPress={() => onDetail(c)}
        />
      </View>
      <View
        style={[
          styles.caption,
          { bottom: bottomInset + 82 },
          compact && { gap: 4 },
          short && photos.length > 1 && { right: 160 },
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.badge}>
          <Icon
            name={hasOffers ? "repeat" : "layers"}
            size={13}
            color="#FFFFFF"
          />
          <Txt size={11} bold color="#FFFFFF">
            {hasOffers ? `공개 오퍼 ${offerCount}개` : "카드 구경"}
          </Txt>
        </View>
        {!short && (
          <Txt size={13} color="#FFFFFF" lines={1} style={styles.overlayText}>
            {"카드 컬렉션"}
            {c.owned_by_me ? " · 내 컬렉션에도 있어요" : ""}
          </Txt>
        )}
        <Txt
          size={compact ? 20 : 23}
          bold
          color="#FFFFFF"
          lines={short ? 1 : 2}
          style={styles.overlayText}
        >
          {c.card.title}
        </Txt>
        {!short && (
          <Txt
            size={13}
            color="#F3F1F9"
            lines={compact ? 1 : 2}
            style={styles.overlayText}
          >
            {hasOffers
              ? "교환·나눔 조건과 실물 사진을 보고 마음에 드는 오퍼를 골라 보세요"
              : "내가 가진 카드라면 첫 교환·나눔 오퍼를 올려 보세요"}
          </Txt>
        )}
        <Txt size={12} color="#DDD8EE" lines={1}>
          {!c.card.imageSrc && photos.length
            ? "공개 오퍼의 실물 사진"
            : "카탈로그 카드 이미지"}{" "}
          ·{" "}
          {hasOffers
            ? `지금 선택할 수 있는 오퍼 ${offerCount}개`
            : "아직 공개된 오퍼가 없어요"}
        </Txt>
        {!!error && (
          <Txt size={12} color="#FFADB9">
            {error}
          </Txt>
        )}
        {!!message && (
          <Txt size={12} color="#FFFFFF">
            {message}
          </Txt>
        )}
      </View>
      <View style={[styles.cardActions, { bottom: bottomInset + 14 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            hasOffers
              ? `공개 오퍼 ${offerCount}개 보기`
              : canRegister
                ? "이 카드 가지고 있어요"
                : "카드 정보 보기"
          }
          onPress={() =>
            hasOffers ? onOffers(c) : canRegister ? onRegister(c) : onDetail(c)
          }
          style={({ pressed }) => [
            styles.cardPrimary,
            {
              opacity: pressed ? 0.88 : 1,
              transform: [{ scale: pressed ? 0.985 : 1 }],
            },
          ]}
        >
          <Icon
            name={hasOffers ? "repeat" : "plus"}
            size={22}
            color="#19151F"
          />
          <Txt bold size={15} color="#19151F">
            {hasOffers
              ? `오퍼 ${offerCount}개 보기`
              : canRegister
                ? "이 카드 가지고 있어요"
                : "카드 정보 보기"}
          </Txt>
          <Icon name="arrow-up-right" size={20} color="#19151F" />
        </Pressable>
        {hasOffers && canRegister && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="이 카드의 내 오퍼 추가"
            onPress={() => onRegister(c)}
            style={styles.addOfferAction}
          >
            <Icon name="plus" color="#FFFFFF" size={23} />
            <Txt size={11} bold color="#FFFFFF">
              내 오퍼
            </Txt>
          </Pressable>
        )}
      </View>
    </View>
  );
});

function FeedAction({
  icon,
  label,
  accessibilityLabel,
  selected = false,
  disabled = false,
  compact = false,
  onPress,
}: {
  icon: ExchangeIconName;
  label: string;
  accessibilityLabel: string;
  selected?: boolean;
  disabled?: boolean;
  compact?: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (value: number) =>
    Animated.spring(scale, {
      toValue: value,
      speed: 32,
      bounciness: 5,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => animate(0.9)}
      onPressOut={() => animate(1)}
      style={styles.socialButton}
    >
      <Animated.View
        style={[
          styles.socialIcon,
          compact && { width: 42, height: 42, borderRadius: 21 },
          { transform: [{ scale }] },
        ]}
      >
        <Icon
          name={icon}
          filled={selected}
          size={compact ? 25 : 28}
          color={selected ? "#FF557C" : "#FFFFFF"}
        />
      </Animated.View>
      <Txt size={12} bold color="#FFFFFF" style={styles.overlayText}>
        {label}
      </Txt>
    </Pressable>
  );
}

function FeedArt({ src }: { src?: string }) {
  const [loadedIdentity, setLoadedIdentity] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fallback, setFallback] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const privatePhoto = src?.startsWith("/objects/");
  const sources = publicCardImageSources(src);
  const media = useMediaResource(
    privatePhoto && Platform.OS !== "web" ? src : undefined,
  );
  const browserPhoto = useBrowserChatPhoto(
    privatePhoto && Platform.OS === "web" ? src : undefined,
    attempt,
  );
  const imageUri = privatePhoto
    ? Platform.OS === "web"
      ? browserPhoto?.uri
      : media.uri
    : fallback
      ? sources.fallback
      : sources.primary;
  const identity = String(imageUri) + ":" + attempt;
  const current = useRef({ identity, loaded: false });
  if (current.current.identity !== identity)
    current.current = { identity, loaded: false };
  const loaded = !!imageUri && loadedIdentity === identity;
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      if (privatePhoto && Platform.OS !== "web") {
        const result = await media.refresh();
        if (result?.error) throw result.error;
      }
      setLoadedIdentity(undefined);
      setFallback(false);
      setAttempt((n) => n + 1);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRetrying(false);
    }
  };
  const onError = () => {
    if (current.current.identity !== identity || current.current.loaded) return;
    if (!privatePhoto && !fallback && sources.fallback) setFallback(true);
    else setFailed(true);
  };
  useEffect(() => {
    if (
      privatePhoto &&
      (Platform.OS === "web" ? browserPhoto?.error : media.error)
    )
      setFailed(true);
  }, [privatePhoto, media.error, browserPhoto?.error]);
  useEffect(() => {
    if (loaded || failed || !imageUri) return;
    const timer = setTimeout(onError, CARD_IMAGE_ATTEMPT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loaded, failed, imageUri, identity, fallback]);
  if (!src || sources.kind === "missing")
    return (
      <View style={styles.placeholder}>
        <Icon name="image" size={40} color="#FFFFFF" />
        <Txt size={12} color="#D8D3E6">
          사진 준비 중
        </Txt>
      </View>
    );
  return (
    <View style={styles.artArea}>
      {!failed && imageUri ? (
        <>
          <Image
            key={identity}
            source={{ uri: imageUri }}
            cachePolicy="memory-disk"
            priority="high"
            transition={0}
            contentFit="contain"
            style={styles.image}
            onLoad={() => {
              if (current.current.identity === identity) {
                current.current.loaded = true;
                setLoadedIdentity(identity);
                setFailed(false);
              }
            }}
            onDisplay={() => {
              if (current.current.identity === identity) {
                current.current.loaded = true;
                setLoadedIdentity(identity);
                setFailed(false);
              }
            }}
            onError={onError}
          />
          <Image
            accessible={false}
            pointerEvents="none"
            source={{ uri: imageUri }}
            cachePolicy="memory-disk"
            priority="low"
            transition={0}
            contentFit="cover"
            blurRadius={24}
            style={styles.backdropImage}
          />
        </>
      ) : null}
      {!loaded && !failed && (
        <View pointerEvents="none" style={styles.placeholder}>
          <Icon name="image" size={36} color="#D8D3E6" />
          <ActivityIndicator color="#FFFFFF" />
        </View>
      )}
      {failed && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="카드 사진 다시 불러오기"
          style={styles.placeholder}
          accessibilityState={{ disabled: retrying, busy: retrying }}
          disabled={retrying}
          onPress={() => void retry()}
        >
          {retrying ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Icon name="refresh-cw" color="#FFFFFF" />
          )}
          <Txt size={12} color="#D8D3E6">
            {retrying ? "사진 주소를 갱신하고 있어요" : "사진 다시 불러오기"}
          </Txt>
        </Pressable>
      )}
    </View>
  );
}

function ExchangeSheet({
  sheet,
  onClose,
  onChoose,
  onRegister,
  onBack,
  patchCard,
}: {
  sheet: Sheet;
  onClose: () => void;
  onChoose: (listing: Listing, card: CardFeedItem) => void;
  onRegister: (card: CardFeedItem) => void;
  onBack: (card: CardFeedItem) => void;
  patchCard: (id: string, patch: Partial<CardFeedItem>) => void;
}) {
  const insets = useSafeAreaInsets();
  const pwa = usePwaBottomInset();
  const { data: me } = useGetMe();
  const consent = useUgcConsent(me?.id ?? null, { presentation: "inline" });
  const [reportTarget, setReportTarget] = useState<ContentReportTarget | null>(
    null,
  );
  const close = () => {
    if (reportTarget) return;
    if (consent.promptProps.visible) {
      consent.promptProps.onCancel();
      return;
    }
    onClose();
  };
  const title =
    sheet.kind === "comments"
      ? "카드 댓글"
      : sheet.kind === "offers"
        ? "이 카드의 오퍼"
        : sheet.kind === "register"
          ? "내 오퍼 등록"
          : actionLabel(sheet.listing);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.modal, { paddingTop: insets.top + 16 }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="창 닫기"
          style={styles.backdrop}
          onPress={onClose}
        />
        <View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(20, insets.bottom, pwa),
              maxHeight: "90%",
            },
          ]}
        >
          <View style={[S.between, { paddingHorizontal: 20, paddingTop: 14 }]}>
            <Txt size={20} bold>
              {title}
            </Txt>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="닫기"
              style={styles.iconButton}
              onPress={onClose}
            >
              <Icon name="x" color={C.ink} />
            </Pressable>
          </View>
          {sheet.kind === "offers" ? (
            <CardOffers
              card={sheet.card}
              onChoose={(listing) => onChoose(listing, sheet.card)}
              onRegister={() => onRegister(sheet.card)}
              onClose={onClose}
              patchCard={patchCard}
            />
          ) : sheet.kind === "register" ? (
            <RegisterCard card={sheet.card} onClose={onClose} />
          ) : sheet.kind === "offer" ? (
            <OfferForm
              listing={sheet.listing}
              onClose={onClose}
              offeredListingId={sheet.offeredListingId}
              onBackToOffers={
                sheet.card ? () => onBack(sheet.card!) : undefined
              }
              ensureConsent={consent.ensureConsent}
            />
          ) : (
            <Comments
              card={sheet.card}
              patchCard={patchCard}
              ensureConsent={consent.ensureConsent}
              onReport={setReportTarget}
            />
          )}
        </View>
        <ContentReportSheet
          target={reportTarget}
          onClose={() => setReportTarget(null)}
          presentation="inline"
        />
        <UgcConsentPrompt {...consent.promptProps} />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CardOffers({
  card,
  onChoose,
  onRegister,
  onClose,
  patchCard,
}: {
  card: CardFeedItem;
  onChoose: (listing: Listing) => void;
  onRegister: () => void;
  onClose: () => void;
  patchCard: (id: string, patch: Partial<CardFeedItem>) => void;
}) {
  const { userId } = useAuth();
  const me = useGetMe();
  const router = useRouter();
  type OffersPage = { items: Listing[]; nextCursor: string | null };
  const path = `${cardFeedPath(card.id)}/offers`;
  const query = useInfiniteQuery({
    queryKey: ["davaq", userId, path],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<OffersPage>(
        path + (pageParam ? "?cursor=" + encodeURIComponent(pageParam) : ""),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    structuralSharing: preserveCardFeedWrites,
    placeholderData: card.available_listings.length
      ? {
          pages: [{ items: card.available_listings, nextCursor: null }],
          pageParams: [""],
        }
      : undefined,
    enabled: !!userId,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const rows = [
    ...new Map(
      (query.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [
        item.id,
        item,
      ]),
    ).values(),
  ].filter(
    (item) =>
      item.card_id === card.id &&
      !!registrationId(item.id) &&
      item.status === "active" &&
      item.available > 0,
  );
  useEffect(() => {
    if (query.isSuccess && !query.isPlaceholderData && !query.hasNextPage) {
      patchCard(card.id, {
        available_listing_count: rows.length,
        available_listings: rows.slice(0, 3),
      });
    }
  }, [query.dataUpdatedAt, query.isPlaceholderData, query.hasNextPage]);
  const choose = (listing: Listing) => {
    if (
      !registrationId(listing.id) ||
      listing.status !== "active" ||
      listing.available < 1 ||
      listing.card_id !== card.id
    )
      return;
    if (listing.owner_id === me.data?.id) {
      onClose();
      router.push(("/tcg/listing/" + listing.id) as any);
    } else onChoose(listing);
  };
  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.id}
      initialNumToRender={4}
      maxToRenderPerBatch={4}
      windowSize={5}
      style={{ flexShrink: 1 }}
      contentContainerStyle={styles.form}
      ListHeaderComponent={
        <View style={{ gap: 10 }}>
          <Txt bold size={17}>
            {card.card.title}
          </Txt>
          <Txt size={13} color={C.muted}>
            실물 사진과 카드 상태, 교환·나눔 조건을 확인한 다음 오퍼를 골라
            주세요.
          </Txt>
          {query.isFetching && !query.isFetchingNextPage && (
            <ActivityIndicator color={C.purple} />
          )}
          {query.isError && <Notice error>{errorText(query.error)}</Notice>}
        </View>
      }
      ListEmptyComponent={
        !query.isPending && !query.isFetching ? (
          <Notice>
            지금 선택할 수 있는 오퍼가 없어요. 내가 가진 카드로 첫 오퍼를 올릴
            수 있어요.
          </Notice>
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            (item.owner_id === me.data?.id ? "내 오퍼 관리: " : "오퍼 선택: ") +
            item.owner_name
          }
          style={styles.offerCard}
          onPress={() => choose(item)}
        >
          <CardArt src={item.photos[0]} />
          <View style={{ flex: 1, gap: 6 }}>
            <Txt bold>
              {item.owner_name || "컬렉터"}
              {item.owner_id === me.data?.id ? " · 내 오퍼" : ""}
            </Txt>
            <Txt size={13} color={C.purple}>
              {modeLabel(item)} · {conditionName(item.condition)} ·{" "}
              {item.available}장
            </Txt>
            <Txt size={12} color={C.muted} lines={2}>
              {item.mode === "gift"
                ? "카드 대가 없이 나눠요"
                : item.wanted_card_names?.length
                  ? `찾는 카드: ${item.wanted_card_names.join(" · ")}`
                  : "내 카드로 자유롭게 제안할 수 있어요"}
            </Txt>
            <Txt size={12} color={C.muted}>
              {item.region || "지역 협의"} ·{" "}
              {item.delivery === "ship"
                ? "배송"
                : item.delivery === "meet"
                  ? "직거래"
                  : "직거래·배송"}
            </Txt>
          </View>
          <Icon name="chevron-right" size={20} />
        </Pressable>
      )}
      ListFooterComponent={
        <View style={{ gap: 12 }}>
          {query.hasNextPage && (
            <Button
              secondary
              label={
                query.isFetchNextPageError
                  ? "오퍼 다시 불러오기"
                  : "다른 오퍼 더 보기"
              }
              busy={query.isFetchingNextPage}
              onPress={() => void query.fetchNextPage()}
            />
          )}
          {query.isError && (
            <Button
              secondary
              label="오퍼 다시 확인"
              onPress={() => void query.refetch()}
            />
          )}
          {card.card.saveAllowed !== false && (
            <Button
              label="이 카드의 내 오퍼 추가"
              icon="plus"
              onPress={onRegister}
            />
          )}
        </View>
      }
    />
  );
}

function RegisterCard({
  card,
  onClose,
}: {
  card: CardFeedItem;
  onClose: () => void;
}) {
  const { userId } = useAuth();
  const router = useRouter();
  const query = useQuery({
    queryKey: ["davaq", userId, "/tcg/collection"],
    queryFn: () => api<Page<Owned>>("/tcg/collection"),
    enabled: !!userId,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const owned = (query.data?.items ?? []).filter(
    (item) =>
      item.card_id === card.id &&
      !!registrationId(item.id) &&
      item.quantity > item.reserved,
  );
  const register = () => {
    if (card.card.saveAllowed === false) return;
    onClose();
    router.push(
      (cardLink(card.card.saveId, card.card.title) + "&publish=1") as any,
    );
  };
  return (
    <ScrollView
      style={{ flexShrink: 1 }}
      contentContainerStyle={styles.form}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.offerCard, { borderWidth: 0, padding: 0 }]}>
        <CardArt src={card.card.imageSrc} catalog />
        <View style={{ flex: 1, gap: 5 }}>
          <Txt bold size={18}>
            {card.card.title}
          </Txt>
          <Txt size={12} color={C.muted}>
            카탈로그 카드
          </Txt>
        </View>
      </View>
      <Txt color={C.muted} size={14}>
        내 실물 카드 사진과 상태를 확인한 뒤 바로 교환·제안 받기·무료 나눔 중
        하나를 선택해요.
      </Txt>
      {query.isPending && <ActivityIndicator color={C.purple} />}
      {query.isError && (
        <Notice error>
          보유 카드를 확인하지 못했어요. 다시 확인하거나 실물 사진으로 새 카드를
          등록해 주세요.
        </Notice>
      )}
      {!!owned.length && <Txt bold>이미 저장한 내 카드</Txt>}
      {owned.map((item) => (
        <View key={item.id} style={styles.offerCard}>
          <CardArt src={item.photos[0]} />
          <View style={{ flex: 1, gap: 7 }}>
            <Txt bold>
              {conditionName(item.condition)} · {item.quantity - item.reserved}
              장
            </Txt>
            <Button
              secondary
              small
              label={
                item.listing_id
                  ? "공개 중인 내 오퍼 보기"
                  : "이 카드로 내 오퍼 등록"
              }
              onPress={() => {
                onClose();
                router.push(
                  (item.listing_id
                    ? "/tcg/listing/" + item.listing_id
                    : "/tcg/sell?collection=" +
                      encodeURIComponent(item.id)) as any,
                );
              }}
            />
          </View>
        </View>
      ))}
      {card.card.saveAllowed === false ? (
        <Notice>
          이 카드의 등록 정보를 확인 중이에요. 지금은 카드 구경과 기존 오퍼
          이용이 가능해요.
        </Notice>
      ) : (
        <Button
          label={
            owned.length
              ? "다른 실물 카드 사진으로 등록"
              : "사진 추가하고 내 오퍼 등록"
          }
          icon="plus"
          onPress={register}
        />
      )}
      {query.isError && (
        <Button
          secondary
          label="내 보유 카드 다시 확인"
          onPress={() => void query.refetch()}
        />
      )}
    </ScrollView>
  );
}

function OfferForm({
  listing: initial,
  onClose,
  offeredListingId,
  onBackToOffers,
  ensureConsent,
}: {
  listing: Listing;
  onClose: () => void;
  offeredListingId?: string;
  onBackToOffers?: () => void;
  ensureConsent: () => Promise<boolean>;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const { userId } = useAuth();
  const me = useGetMe();
  const targetId = registrationId(initial.id);
  const target = useQuery({
    queryKey: ["davaq", userId, "/tcg/listings/" + targetId],
    queryFn: () => api<Listing>("/tcg/listings/" + targetId),
    enabled: !!userId && !!targetId,
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  const l = target.data ?? initial;
  const isOwn = !!me.data?.id && l.owner_id === me.data.id;
  const usable =
    !!targetId &&
    target.isSuccess &&
    !target.isFetching &&
    !target.isError &&
    !!me.data?.id &&
    l.status === "active" &&
    l.available > 0 &&
    !isOwn;
  const own = useQuery({
    queryKey: ["davaq", userId, "/tcg/listings?mine=true"],
    queryFn: () => api<Page<Listing>>("/tcg/listings?mine=true"),
    enabled: !!userId && l.mode !== "gift",
    staleTime: 15000,
    refetchOnMount: "always",
  });
  const [selectedId, setSelectedId] = useState(offeredListingId ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestKey = useRef(key());
  const candidates = (own.data?.items ?? []).filter(
    (item) =>
      (item.mode === "swap" || item.mode === "both") &&
      !!registrationId(item.id) &&
      item.status === "active" &&
      item.available > 0 &&
      (!l.wanted_card_ids.length || l.wanted_card_ids.includes(item.card_id)),
  );
  const collection = useQuery({
    queryKey: ["davaq", userId, "/tcg/collection"],
    queryFn: () => api<Page<Owned>>("/tcg/collection"),
    enabled: l.mode !== "gift" && own.isSuccess && !candidates.length,
    staleTime: 0,
  });
  const unpublished = (collection.data?.items ?? []).filter(
    (item) =>
      !item.listing_id &&
      item.quantity > item.reserved &&
      (!l.wanted_card_ids.length || l.wanted_card_ids.includes(item.card_id)),
  );
  const offered = candidates.find((item) => item.id === selectedId);
  const submit = async () => {
    if (busy || !usable || (l.mode !== "gift" && !offered)) return;
    setBusy(true);
    setError("");
    try {
      if (!(await ensureConsent())) return;
      const trade = await api<{ id: string }>("/tcg/trades", "POST", {
        listingId: l.id,
        listingVersion: l.version,
        kind: l.mode === "gift" ? "gift" : "swap",
        quantity: 1,
        ...(l.mode === "gift"
          ? {}
          : {
              offeredListingId: offered?.id,
              offeredVersion: offered?.version,
              offeredQuantity: 1,
            }),
        cash: 0,
        note,
        requestKey: requestKey.current,
      });
      // Keep the current feed snapshot and position. The transaction screen
      // fetches the new trade; existing transaction lists need a narrow refresh.
      void client.invalidateQueries({
        queryKey: ["davaq", userId],
        predicate: (entry) =>
          typeof entry.queryKey[2] === "string" &&
          entry.queryKey[2].startsWith("/tcg/trades"),
      });
      void client.invalidateQueries({ queryKey: ["/api/rooms"] });
      onClose();
      router.push(("/tcg/trade/" + trade.id) as any);
    } catch (e) {
      setError(errorText(e));
      if ([404, 409, 410].includes((e as { status?: number }).status ?? 0)) {
        void target.refetch();
        void own.refetch();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <FlatList
      data={l.mode === "gift" ? [] : candidates}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={3}
      maxToRenderPerBatch={3}
      windowSize={5}
      style={{ flexShrink: 1 }}
      contentContainerStyle={styles.form}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: offered?.id === item.id }}
          onPress={() => setSelectedId(item.id)}
          style={[
            styles.offerCard,
            { marginBottom: 12 },
            offered?.id === item.id && {
              borderColor: C.purple,
              backgroundColor: C.soft,
            },
          ]}
        >
          <CardArt src={item.photos[0]} />
          <View style={{ flex: 1, gap: 5 }}>
            <Txt bold lines={2}>
              {item.card_name}
            </Txt>
            <Txt size={12} color={C.muted}>
              {conditionName(item.condition)} · {item.available}장 가능
            </Txt>
          </View>
          <Icon name={offered?.id === item.id ? "check-circle" : "circle"} />
        </Pressable>
      )}
      ListHeaderComponent={
        <View style={{ gap: 14, paddingBottom: 14 }}>
          <Txt size={14} color={C.muted} lines={2}>
            {l.card_name} · 1장
          </Txt>
          {target.isFetching && <ActivityIndicator color={C.purple} />}
          {target.isError && (
            <Notice error>
              이 오퍼를 다시 확인하지 못했어요. 삭제됐거나 거래 조건이 바뀌었을
              수 있어요.
            </Notice>
          )}
          {target.isSuccess && (l.status !== "active" || l.available < 1) && (
            <Notice>
              현재 거래할 수 없는 오퍼예요. 다른 오퍼를 골라 주세요.
            </Notice>
          )}
          {isOwn && (
            <Notice>
              내가 올린 오퍼예요. 내 오퍼 관리에서 조건을 확인하거나 내려
              주세요.
            </Notice>
          )}
          {l.mode !== "gift" ? (
            <>
              <Txt bold>내가 줄 카드 한 장을 골라 주세요</Txt>
              {own.isPending && <ActivityIndicator color={C.purple} />}
              {own.isError && <Notice error>{errorText(own.error)}</Notice>}
              {offeredListingId &&
                own.isSuccess &&
                !own.isFetching &&
                !candidates.some((item) => item.id === offeredListingId) && (
                  <Notice>
                    카드는 공개됐지만 상대의 교환 조건과 맞지 않거나 현재 거래할
                    수 없어요. 다른 교환 카드를 선택해 주세요.
                  </Notice>
                )}
              {own.isSuccess && !candidates.length && (
                <Notice>
                  {unpublished.length
                    ? "보유 카드 저장은 완료돼 있어요. 교환용 공개 설정을 마치면 이 카드로 제안할 수 있어요."
                    : "조건에 맞게 공개된 내 교환 카드가 아직 없어요. 보유 카드 저장과 교환용 공개 설정을 이어서 진행할 수 있어요."}
                </Notice>
              )}
            </>
          ) : (
            <Notice>
              카드 대가 없이 나눔을 신청합니다. 배송비와 전달 방법은 상대와
              확인해 주세요.
            </Notice>
          )}
        </View>
      }
      ListFooterComponent={
        <View style={{ gap: 14 }}>
          {onBackToOffers && (
            <Button secondary label="다른 오퍼 보기" onPress={onBackToOffers} />
          )}
          {isOwn && (
            <Button
              secondary
              label="내 오퍼 관리"
              onPress={() => {
                onClose();
                router.push(("/tcg/listing/" + l.id) as any);
              }}
            />
          )}
          {target.isError && (
            <Button
              secondary
              label="오퍼 다시 확인"
              onPress={() => void target.refetch()}
            />
          )}
          {l.mode !== "gift" && !isOwn && (
            <Button
              secondary
              label={
                unpublished.length
                  ? "보유 카드 공개하고 제안하기"
                  : "내 카드 등록하고 제안하기"
              }
              icon="plus"
              onPress={() => {
                onClose();
                router.push({
                  pathname: "/tcg/sell",
                  params: {
                    offerListing: l.id,
                    ...(unpublished.length === 1
                      ? { collection: unpublished[0].id }
                      : {}),
                  },
                } as any);
              }}
            />
          )}
          <Field
            label="한마디 (선택)"
            value={note}
            onChangeText={setNote}
            maxLength={500}
            placeholder="편한 전달 방법이나 인사를 남겨 주세요"
            multiline
          />
          <Txt size={12} color={C.muted}>
            상대가 수락하면 거래가 확정돼요. 확정 전에는 카드가 예약되지 않아요.
          </Txt>
          {!!error && <Notice error>{error}</Notice>}
          <Button
            label={l.mode === "gift" ? "나눔 신청 보내기" : "교환 제안 보내기"}
            disabled={!usable || (l.mode !== "gift" && !offered)}
            busy={busy}
            onPress={() => void submit()}
          />
        </View>
      }
    />
  );
}

function Comments({
  card,
  patchCard,
  ensureConsent,
  onReport,
}: {
  card: CardFeedItem;
  patchCard: (id: string, patch: Partial<CardFeedItem>) => void;
  ensureConsent: () => Promise<boolean>;
  onReport: (target: ContentReportTarget) => void;
}) {
  const { userId } = useAuth();
  const { data: me } = useGetMe();
  const router = useRouter();
  const client = useQueryClient();
  const path = `${cardFeedPath(card.id)}/comments`;
  const queryKey = ["davaq", userId, path];
  type CommentsPage = { items: Comment[]; nextCursor: string | null };
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<CommentsPage>(
        path + (pageParam ? "?cursor=" + encodeURIComponent(pageParam) : ""),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    structuralSharing: preserveCardFeedWrites,
    staleTime: 15000,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ body: string; key: string } | null>(null);
  const submit = async () => {
    const text = body.trim();
    if (!text || busy) return;
    if (!request.current || request.current.body !== text)
      request.current = { body: text, key: key() };
    setBusy(true);
    setError("");
    try {
      if (!(await ensureConsent())) return;
      const result = await api<{ item: Comment; comment_count: number }>(
        path,
        "POST",
        { body: text, requestKey: request.current.key },
      );
      client.setQueryData<InfiniteData<CommentsPage>>(queryKey, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page, index) => ({
                ...page,
                items: [
                  ...(index === 0 ? [result.item] : []),
                  ...page.items.filter((v) => v.id !== result.item.id),
                ],
              })),
            }
          : {
              pages: [{ items: [result.item], nextCursor: null }],
              pageParams: [""],
            },
      );
      patchCard(card.id, { comment_count: result.comment_count });
      setBody("");
      request.current = null;
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ flexShrink: 1, minHeight: 240 }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ flexShrink: 1 }}
        contentContainerStyle={styles.form}
      >
        {query.isPending && <ActivityIndicator color={C.purple} />}
        {query.isError && <Notice error>{errorText(query.error)}</Notice>}
        {query.isSuccess && !items.length && (
          <Txt color={C.muted}>이 카드의 첫 댓글을 남겨 보세요.</Txt>
        )}
        {items.map((item) => (
          <View
            key={item.id}
            style={{
              gap: 5,
              paddingBottom: 14,
              borderBottomWidth: 1,
              borderColor: C.line,
            }}
          >
            <View style={S.between}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.owner_name || "컬렉터"} 프로필 보기`}
                onPress={() =>
                  router.push({
                    pathname: "/profile/[userId]",
                    params: { userId: item.owner_id },
                  })
                }
              >
                <Txt bold size={13}>
                  {item.owner_name || "컬렉터"}
                </Txt>
              </Pressable>
              <Txt size={11} color={C.muted}>
                {new Date(item.created_at).toLocaleDateString("ko-KR")}
              </Txt>
            </View>
            <Txt size={14}>{item.body}</Txt>
            {me?.id && item.owner_id !== me.id && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="댓글 신고"
                onPress={() =>
                  onReport({
                    targetType: "card_comment",
                    targetId: item.id,
                  })
                }
                style={{
                  alignSelf: "flex-end",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  minHeight: 44,
                  paddingHorizontal: 8,
                }}
              >
                <Feather name="flag" size={14} color={C.muted} />
                <Txt size={12} color={C.muted}>
                  신고
                </Txt>
              </Pressable>
            )}
          </View>
        ))}
        {query.hasNextPage && (
          <Button
            secondary
            label={
              query.isFetchNextPageError
                ? "댓글 다시 불러오기"
                : "이전 댓글 보기"
            }
            busy={query.isFetchingNextPage}
            onPress={() => void query.fetchNextPage()}
          />
        )}
      </ScrollView>
      <View
        style={{ padding: 20, gap: 10, borderTopWidth: 1, borderColor: C.line }}
      >
        {!!error && (
          <Txt color={C.red} size={12}>
            {error}
          </Txt>
        )}
        <Field
          label="댓글 남기기"
          value={body}
          onChangeText={setBody}
          maxLength={500}
          multiline
          placeholder="질문이나 응원을 남겨 주세요"
        />
        <Button
          label="댓글 등록"
          disabled={!body.trim()}
          busy={busy}
          onPress={() => void submit()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, backgroundColor: "#090811" },
  content: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    maxWidth: 740,
    alignSelf: "center",
  },
  header: {
    position: "absolute",
    left: 20,
    right: 20,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    zIndex: 20,
  },
  headerIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: "rgba(10,8,18,0.24)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
  },
  registerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  search: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 21,
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 14,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    gap: 8,
  },
  filterChip: {
    position: "absolute",
    left: 20,
    maxWidth: 220,
    zIndex: 20,
    paddingLeft: 14,
    borderRadius: 22,
    backgroundColor: "rgba(8,6,16,0.65)",
    flexDirection: "row",
    alignItems: "center",
  },
  notice: { position: "absolute", left: 20, right: 20, zIndex: 22 },
  iconButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  feed: { flex: 1, minHeight: 0, overflow: "hidden" },
  list: { flex: 1, minHeight: 0 },
  slide: {
    width: "100%",
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#15121F",
  },
  artArea: { ...StyleSheet.absoluteFillObject, overflow: "hidden", zIndex: 0 },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    zIndex: 1,
  },
  backdropImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    zIndex: 0,
    opacity: 0.72,
    transform: [{ scale: 1.15 }],
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#15121F",
  },
  topGradient: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 1 },
  bottomGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1,
  },
  overlayText: {
    textShadowColor: "rgba(0,0,0,0.40)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: "rgba(113,78,239,0.86)",
    marginBottom: 3,
  },
  social: {
    position: "absolute",
    right: 13,
    zIndex: 4,
    gap: 15,
    alignItems: "center",
  },
  socialButton: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 48,
    gap: 4,
  },
  socialIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,8,18,0.24)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  caption: { position: "absolute", left: 20, right: 84, zIndex: 4, gap: 6 },
  cardActions: {
    position: "absolute",
    left: 20,
    right: 20,
    zIndex: 4,
    flexDirection: "row",
    gap: 10,
  },
  cardPrimary: {
    flex: 1,
    minHeight: 54,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FFFFFF",
  },
  addOfferAction: {
    minWidth: 66,
    minHeight: 54,
    borderRadius: 18,
    paddingHorizontal: 9,
    justifyContent: "center",
    alignItems: "center",
    gap: 2,
    backgroundColor: "rgba(10,8,18,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
  },
  photoNavigation: {
    position: "absolute",
    right: 16,
    zIndex: 3,
    padding: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 30,
    backgroundColor: "rgba(10,8,18,0.44)",
  },
  photoButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: { padding: 20, justifyContent: "center" },
  modal: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    width: "100%",
    maxWidth: 740,
    alignSelf: "center",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: C.white,
    flexShrink: 1,
  },
  form: { padding: 20, gap: 14 },
  offerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
  },
});
