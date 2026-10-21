import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useCreateRoom,
  useGetMe,
  useBlockUser,
} from "@workspace/api-client-react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/Avatar";
import { ContentReportSheet } from "@/components/ContentReportSheet";
import { MessengerSheet } from "@/components/chat/MessengerUI";
import { clearBlockedUserCaches } from "@/lib/contentReports";
import { CardArt } from "@/components/tcg/Cards";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/davaqAuth";
import {CollectorProfileScreen,collectorIds} from "@/components/davaq/CollectorProfile";
import {
  cardLink,
  conditionName,
  errorText,
  statusName,
  useDavaq,
  type Listing,
  type Owned,
  type Page,
  type Trade,
} from "@/lib/tcg";

const PROFILE_TABS = [
  ["collection", "보유 카드"],
  ["offers", "공개 오퍼"],
  ["trades", "거래 기록"],
] as const;
type ProfileTab = (typeof PROFILE_TABS)[number][0] | "intro";
type Profile = {
  id: string;
  nickname: string;
  profileImageUrl: string | null;
  statusMessage: string | null;
  createdAt: string;
  stats: { publicCards: number; publicOffers: number; comments: number };
  offers: Listing[];
  nextCursor: string | null;
};

export default function PublicProfileScreen() {
  const {userId}=useLocalSearchParams<{userId:string}>();
  return collectorIds.includes(userId) ? <CollectorProfileScreen collectorId={userId}/> : <RegularPublicProfileScreen/>;
}
function RegularPublicProfileScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const params = useLocalSearchParams<{ userId: string }>();
  const targetId = Array.isArray(params.userId)
    ? params.userId[0]
    : params.userId;
  const { userId, isSignedIn } = useAuth();
  const { data: me } = useGetMe();
  const queryClient = useQueryClient();
  const blockUser = useBlockUser();
  const [reportOpen, setReportOpen] = React.useState(false);
  const [blockOpen, setBlockOpen] = React.useState(false);
  const [blockError, setBlockError] = React.useState("");
  const blockLock = React.useRef(false);
  const profileQuery = useInfiniteQuery({
    queryKey: ["davaq", userId, "public-profile", targetId],
    enabled: !!targetId && !!isSignedIn,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      customFetch<Profile>(
        "/api/tcg/users/" +
          encodeURIComponent(targetId) +
          "/profile" +
          (pageParam ? "?cursor=" + encodeURIComponent(pageParam) : ""),
        { signal, responseType: "json" },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  useFocusEffect(
    React.useCallback(() => {
      if (targetId && isSignedIn) void profileQuery.refetch();
    }, [targetId, isSignedIn, profileQuery.refetch]),
  );
  const profile = profileQuery.data?.pages[0];
  const isMe = !!profile && profile.id === me?.id;
  const canModerate = !!isSignedIn && !!me?.id && !isMe;
  const [activeTab, setActiveTab] = React.useState<ProfileTab>("collection");
  const [chatError, setChatError] = React.useState("");
  const chatLock = React.useRef(false);
  const createRoom = useCreateRoom();
  // Owner-only endpoints must never stand in for another user's private cards,
  // or for total profile counts: their responses are bounded by the server.
  const collection = useDavaq<Page<Owned>>(
    "/tcg/collection",
    isMe && activeTab === "collection",
  );
  const trades = useDavaq<Page<Trade>>(
    "/tcg/trades",
    isMe && activeTab === "trades",
  );
  React.useEffect(() => {
    setActiveTab("collection");
    setChatError("");
    setReportOpen(false);
    setBlockOpen(false);
    setBlockError("");
  }, [targetId]);
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };
  async function openChat() {
    if (!profile || isMe || chatLock.current) return;
    chatLock.current = true;
    setChatError("");
    try {
      const room = await createRoom.mutateAsync({
        data: { type: "direct", memberIds: [profile.id] },
      });
      router.push({ pathname: "/chat/[id]", params: { id: room.id } });
    } catch (error) {
      setChatError(errorText(error));
    } finally {
      chatLock.current = false;
    }
  }
  async function confirmBlock() {
    if (!profile || !canModerate || blockLock.current) return;
    blockLock.current = true;
    setBlockError("");
    try {
      await blockUser.mutateAsync({ data: { blockedUserId: profile.id } });
      await clearBlockedUserCaches(queryClient, userId);
      setBlockOpen(false);
      goBack();
    } catch {
      setBlockError("차단하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      blockLock.current = false;
    }
  }
  if ((profileQuery.isError && !profile) || !targetId)
    return (
      <View style={styles.center}>
        <Text style={styles.title}>프로필을 불러오지 못했어요.</Text>
        {!!targetId && (
          <Pressable
            onPress={() => void profileQuery.refetch()}
            style={styles.button}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>다시 시도</Text>
          </Pressable>
        )}
        <Pressable
          onPress={goBack}
          style={styles.back}
          accessibilityRole="button"
        >
          <Text style={styles.muted}>돌아가기</Text>
        </Pressable>
      </View>
    );
  if (profileQuery.isLoading || !profile)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.muted}>프로필을 불러오는 중이에요.</Text>
      </View>
    );
  const visibleTab = isMe
    ? activeTab
    : activeTab === "intro"
      ? "intro"
      : "offers";
  const tabs = isMe
    ? PROFILE_TABS
    : ([
        ["offers", "공개 오퍼"],
        ["intro", "소개"],
      ] as const);
  const privateQuery = visibleTab === "collection" ? collection : trades;
  const publicOffers = [
    ...new Map(
      profileQuery.data?.pages
        .flatMap((page) => page.offers)
        .map((offer) => [offer.id, offer]),
    ).values(),
  ];
  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 48 },
        ]}
      >
        <Pressable
          onPress={goBack}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="이전 화면으로 돌아가기"
        >
          <Feather name="arrow-left" size={21} color={colors.foreground} />
        </Pressable>
        <View style={styles.hero}>
          <View style={styles.avatar}>
            <Avatar
              uri={profile.profileImageUrl}
              name={profile.nickname}
              size={86}
            />
          </View>
          <Text style={styles.name}>{profile.nickname}</Text>
          {profile.statusMessage ? (
            <Text style={styles.status}>{profile.statusMessage}</Text>
          ) : null}
          <View style={styles.counts}>
            <Text style={styles.count}>
              <Text style={styles.countStrong}>
                {profile.stats.publicCards}
              </Text>{" "}
              공개 카드
            </Text>
            <Text style={styles.count}>
              <Text style={styles.countStrong}>
                {profile.stats.publicOffers}
              </Text>{" "}
              공개 오퍼
            </Text>
            <Text style={styles.count}>
              <Text style={styles.countStrong}>{profile.stats.comments}</Text>{" "}
              댓글
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={!isMe && createRoom.isPending}
            onPress={
              isMe ? () => router.push("/profile/edit") : () => void openChat()
            }
            style={[
              styles.button,
              !isMe && createRoom.isPending && styles.busy,
            ]}
          >
            <Text style={styles.buttonText}>
              {isMe
                ? "프로필 수정"
                : createRoom.isPending
                  ? "대화 연결 중…"
                  : "대화하기"}
            </Text>
          </Pressable>
          {canModerate && (
            <View style={styles.safetyActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="사용자 신고"
                onPress={() => setReportOpen(true)}
                style={styles.safetyButton}
              >
                <Feather name="flag" size={16} color={colors.mutedForeground} />
                <Text style={styles.muted}>신고</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="사용자 차단"
                disabled={blockUser.isPending}
                onPress={() => {
                  setBlockError("");
                  setBlockOpen(true);
                }}
                style={styles.safetyButton}
              >
                <Feather name="slash" size={16} color={colors.destructive} />
                <Text style={styles.error}>차단</Text>
              </Pressable>
            </View>
          )}
          {!!chatError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {chatError}
            </Text>
          )}
        </View>
        <>
          <View style={styles.tabs} accessibilityRole="tablist">
            {tabs.map(([tab, label]) => (
              <Pressable
                key={tab}
                onPress={() => setActiveTab(tab)}
                accessibilityRole="tab"
                accessibilityState={{ selected: visibleTab === tab }}
                style={[styles.tab, visibleTab === tab && styles.tabActive]}
              >
                <Text style={styles.tabText}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {tabs.find(([tab]) => tab === visibleTab)?.[1]}
            </Text>
            {visibleTab === "intro" ? (
              <Text style={styles.postBody}>
                {profile.statusMessage ||
                  "아직 수집가 소개를 작성하지 않았어요."}
              </Text>
            ) : visibleTab === "offers" ? (
              <>
                {publicOffers.map((offer) => (
                  <Pressable
                    key={offer.id}
                    onPress={() =>
                      router.push(("/tcg/listing/" + offer.id) as never)
                    }
                    style={styles.post}
                    accessibilityRole="button"
                    accessibilityLabel={offer.card_name + " 오퍼 보기"}
                  >
                    <Text style={styles.postTitle}>{offer.card_name}</Text>
                    <Text style={styles.postBody}>
                      {offer.mode === "gift"
                        ? "무료 나눔"
                        : offer.mode === "sale"
                          ? "판매"
                          : offer.wanted_card_ids.length
                            ? "바로 교환"
                            : "제안 받기"}{" "}
                      · {offer.available}장 거래 가능
                    </Text>
                  </Pressable>
                ))}
                {!publicOffers.length && (
                  <Text style={styles.muted}>현재 공개한 오퍼가 없어요.</Text>
                )}
                {profileQuery.isFetchNextPageError && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    다음 오퍼를 불러오지 못했어요. 다시 시도해 주세요.
                  </Text>
                )}
                {profileQuery.hasNextPage && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={profileQuery.isFetchingNextPage}
                    onPress={() => void profileQuery.fetchNextPage()}
                    style={styles.post}
                  >
                    <Text style={styles.postTitle}>
                      {profileQuery.isFetchingNextPage
                        ? "오퍼 불러오는 중…"
                        : "오퍼 더 보기"}
                    </Text>
                  </Pressable>
                )}
              </>
            ) : privateQuery.isLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : privateQuery.isError ? (
              <Pressable
                onPress={() => void privateQuery.refetch()}
                style={styles.post}
                accessibilityRole="button"
              >
                <Text style={styles.postTitle}>목록을 불러오지 못했어요.</Text>
                <Text style={styles.postBody}>눌러서 다시 확인해 주세요.</Text>
              </Pressable>
            ) : (
              <>
                {visibleTab === "collection" &&
                  collection.data?.items.slice(0, 12).map((card) => (
                    <Pressable
                      key={card.id}
                      onPress={() =>
                        router.push(
                          cardLink(card.card_id, card.card_name) as never,
                        )
                      }
                      style={[styles.post, styles.cardRow]}
                      accessibilityRole="button"
                      accessibilityLabel={card.card_name + " 카드 상세 보기"}
                    >
                      <CardArt src={card.photos[0]} />
                      <View style={styles.cardCopy}>
                        <Text style={styles.postTitle}>{card.card_name}</Text>
                        <Text style={styles.postBody}>
                          {conditionName(card.condition)} · {card.quantity}장
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                {visibleTab === "trades" &&
                  trades.data?.items.slice(0, 20).map((trade) => (
                    <Pressable
                      key={trade.id}
                      onPress={() =>
                        router.push(("/tcg/trade/" + trade.id) as never)
                      }
                      style={styles.post}
                      accessibilityRole="button"
                      accessibilityLabel="거래 상세 보기"
                    >
                      <Text style={styles.postTitle}>
                        {trade.snapshot.target.card_name}
                      </Text>
                      <Text style={styles.postBody}>
                        {statusName(trade.status)} ·{" "}
                        {trade.kind === "gift" ? "나눔" : "교환"}{" "}
                        {trade.quantity}장
                      </Text>
                    </Pressable>
                  ))}
                {privateQuery.data?.items.length === 0 && (
                  <Text style={styles.muted}>
                    {visibleTab === "collection"
                      ? "아직 보유 카드를 등록하지 않았어요."
                      : "아직 거래 기록이 없어요."}
                  </Text>
                )}
                {visibleTab === "collection" &&
                  !!collection.data?.items.length && (
                    <Text style={styles.muted}>
                      최근 업데이트한 보유 카드를 최대 12개 표시해요.
                    </Text>
                  )}
                {visibleTab === "trades" && !!trades.data?.items.length && (
                  <Text style={styles.muted}>
                    최근 업데이트한 거래를 최대 20개 표시해요. 전체 기록은
                    컬렉션의 거래 기록에서 확인할 수 있어요.
                  </Text>
                )}
                {visibleTab === "collection" && (
                  <Pressable
                    onPress={() => router.push("/(tabs)/exchanges")}
                    style={styles.post}
                    accessibilityRole="button"
                  >
                    <Text style={styles.postTitle}>내 컬렉션 관리</Text>
                    <Text style={styles.postBody}>
                      보유 카드를 추가하고 교환·나눔으로 공개하세요.
                    </Text>
                  </Pressable>
                )}
              </>
            )}
          </View>
        </>
      </ScrollView>
      <ContentReportSheet
        target={
          canModerate && reportOpen
            ? { targetType: "user", targetId: profile.id }
            : null
        }
        onClose={() => setReportOpen(false)}
      />
      <MessengerSheet
        visible={canModerate && blockOpen}
        title="이 사용자를 차단할까요?"
        onClose={() => {
          if (!blockLock.current) setBlockOpen(false);
        }}
      >
        <View style={{ padding: 16, gap: 16 }}>
          <Text style={styles.postBody}>
            {profile.nickname}님의 프로필·오퍼·댓글이 숨겨지고 서로 직접
            대화하거나 전화할 수 없게 돼요. 기존 기록이 영구 삭제되지는 않으며
            설정에서 차단을 해제할 수 있어요.
          </Text>
          {!!blockError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {blockError}
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="사용자 차단 확인"
            accessibilityState={{
              disabled: blockUser.isPending,
              busy: blockUser.isPending,
            }}
            disabled={blockUser.isPending}
            style={[
              styles.button,
              { backgroundColor: colors.destructive },
              blockUser.isPending && styles.busy,
            ]}
            onPress={() => void confirmBlock()}
          >
            <Text style={styles.buttonText}>
              {blockUser.isPending ? "차단 중…" : "차단하기"}
            </Text>
          </Pressable>
        </View>
      </MessengerSheet>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: 20,
    },
    content: { padding: 20, paddingBottom: 48 },
    back: { paddingVertical: 12, alignSelf: "flex-start", minWidth: 44 },
    hero: { alignItems: "center", marginTop: 8 },
    avatar: {
      width: 96,
      height: 96,
      borderRadius: 48,
      padding: 4,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    name: {
      color: colors.foreground,
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      marginTop: 12,
    },
    title: {
      color: colors.foreground,
      fontFamily: "Inter_700Bold",
      fontSize: 15,
    },
    status: {
      color: colors.mutedForeground,
      fontSize: 12,
      marginTop: 5,
      lineHeight: 18,
      textAlign: "center",
    },
    counts: { flexDirection: "row", gap: 20, marginTop: 14 },
    count: { color: colors.mutedForeground, fontSize: 11 },
    countStrong: { color: colors.foreground, fontFamily: "Inter_700Bold" },
    actions: { alignItems: "center", marginTop: 18, gap: 10 },
    safetyActions: { flexDirection: "row", alignItems: "center", gap: 20 },
    safetyButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 44,
      paddingHorizontal: 8,
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 999,
      paddingHorizontal: 28,
      paddingVertical: 12,
      minHeight: 44,
      justifyContent: "center",
    },
    buttonText: {
      color: colors.primaryForeground,
      fontFamily: "Inter_600SemiBold",
      fontSize: 12,
    },
    busy: { opacity: 0.6 },
    error: { color: colors.destructive, fontSize: 12, lineHeight: 18 },
    tabs: {
      flexDirection: "row",
      gap: 6,
      marginTop: 24,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingBottom: 8,
    },
    tab: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 12,
      borderRadius: 8,
      minHeight: 44,
    },
    tabActive: { backgroundColor: colors.accent },
    tabText: {
      color: colors.foreground,
      fontFamily: "Inter_600SemiBold",
      fontSize: 11,
    },
    section: { marginTop: 16, gap: 10 },
    sectionTitle: {
      color: colors.foreground,
      fontFamily: "Inter_700Bold",
      fontSize: 15,
    },
    muted: { color: colors.mutedForeground, fontSize: 11, lineHeight: 18 },
    post: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      gap: 5,
    },
    postTitle: {
      color: colors.foreground,
      fontFamily: "Inter_600SemiBold",
      fontSize: 12,
    },
    postBody: { color: colors.mutedForeground, fontSize: 11, lineHeight: 18 },
    cardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    cardCopy: { flex: 1, gap: 5 },
  });
