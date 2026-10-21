import React from "react";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetRoomQueryKey,
  getListRoomsQueryKey,
  useCreateRoom,
  useGetMe,
  useListFriends,
} from "@workspace/api-client-react";
import { Avatar } from "@/components/Avatar";
import { useColors } from "@/hooks/useColors";
import {
  spacing,
  radii,
  typography,
  interaction,
} from "@/constants/designSystem";
import { crossAlert } from "@/lib/crossAlert";
import { userDisplayName } from "@/lib/friendNames";
import { UgcConsentPrompt, useUgcConsent } from "@/components/UgcConsentPrompt";

const categories = [
  ["fanclub", "팬클럽"],
  ["counseling", "고민상담"],
  ["friend_finding", "친구찾기"],
  ["meetup", "번개·만남"],
  ["casual", "잡담"],
  ["peer", "또래방"],
  ["karaoke", "노래방"],
] as const;

export default function GroupCreateScreenV2() {
  const colors = useColors();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cache = useQueryClient();
  const friendsQuery = useListFriends();
  const createRoom = useCreateRoom();
  const me = useGetMe();
  const consent = useUgcConsent(me.data?.id);
  const [step, setStep] = React.useState<1 | 2>(1);
  const [name, setName] = React.useState("");
  const [category, setCategory] =
    React.useState<(typeof categories)[number][0]>("casual");
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const submitting = React.useRef(false);
  const friends = friendsQuery.data ?? [];
  React.useEffect(() => {
    if (!friendsQuery.data) return;
    const valid = new Set(friendsQuery.data.map((friend) => friend.id));
    setSelected((current) => {
      const next = current.filter((id) => valid.has(id));
      return next.length === current.length ? current : next;
    });
  }, [friendsQuery.data]);
  const visible = friends.filter((friend) =>
    userDisplayName(friend)
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const back = () => {
    if (submitting.current) return;
    if (step === 2) {
      setStep(1);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/chats");
  };
  useFocusEffect(
    React.useCallback(() => {
      if (Platform.OS !== "android") return;
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (submitting.current) return true;
          if (step === 2) {
            setStep(1);
            return true;
          }
          return false;
        },
      );
      return () => subscription.remove();
    }, [step]),
  );

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length < 99
          ? [...current, id]
          : current,
    );
  const submit = async () => {
    if (submitting.current || !name.trim() || !selected.length) return;
    submitting.current = true;
    try {
      if (!(await consent.ensureConsent())) return;
      const room = await createRoom.mutateAsync({
        data: {
          type: "group",
          name: name.trim(),
          memberIds: selected,
          category,
          visibility: "invite_only",
        },
      });
      cache.setQueryData(getGetRoomQueryKey(room.id), room);
      // Do not make navigation depend on a second network request.
      void cache.invalidateQueries({ queryKey: getListRoomsQueryKey() });
      router.replace({ pathname: "/chat/[id]", params: { id: room.id } });
    } catch (error) {
      const data = (error as { data?: { error?: string; code?: string } }).data;
      const code = String(
        data?.code ??
          data?.error ??
          (error instanceof Error ? error.message : ""),
      );
      if (code.includes("FRIEND_REQUIRED") || code.includes("BLOCKED_MEMBER")) {
        void friendsQuery.refetch();
        setStep(1);
        crossAlert(
          "참여자를 확인해주세요",
          "친구 상태나 차단 관계가 변경됐습니다. 참여자를 다시 선택해주세요.",
        );
      } else
        crossAlert(
          "그룹을 만들지 못했어요",
          "입력한 내용은 유지됩니다. 다시 시도해주세요.",
        );
    } finally {
      submitting.current = false;
    }
  };
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={back}
          disabled={createRoom.isPending}
          accessibilityRole="button"
          accessibilityLabel="뒤로 가기"
          style={styles.iconButton}
        >
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </Pressable>
        <Text style={styles.title}>
          {step === 1 ? "참여자 선택" : "새 그룹 만들기"}
        </Text>
        <Text style={styles.caption}>{step}/2</Text>
      </View>
      {step === 1 ? (
        <FlatList
          style={{ flex: 1 }}
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.content}
          data={visible}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View>
              <Text style={styles.subtitle}>
                함께 이야기할 친구를 선택하세요 · {selected.length}/99
              </Text>
              <TextInput
                accessibilityLabel="친구 검색"
                placeholder="친구 이름 검색"
                placeholderTextColor={colors.mutedForeground}
                style={styles.input}
                value={query}
                onChangeText={setQuery}
              />
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              {friendsQuery.isLoading ? (
                <ActivityIndicator color={colors.primary} />
              ) : friendsQuery.isError ? (
                <>
                  <Text style={styles.subtitle}>
                    친구 목록을 불러오지 못했어요
                  </Text>
                  <Pressable
                    onPress={() => void friendsQuery.refetch()}
                    style={styles.iconButton}
                  >
                    <Text style={{ color: colors.primary }}>다시 시도</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.subtitle}>
                    {query ? "검색 결과가 없어요" : "먼저 친구를 추가해주세요"}
                  </Text>
                  {!query && (
                    <Pressable
                      onPress={() => router.push("/friends/add")}
                      style={styles.iconButton}
                    >
                      <Text style={{ color: colors.primary }}>친구 추가</Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const active = selected.includes(item.id);
            const profile = (
              item as typeof item & {
                profile?: { profileImageUrl?: string; type?: string };
              }
            ).profile;
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
                onPress={() => toggle(item.id)}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { opacity: interaction.pressedOpacity },
                ]}
              >
                <Avatar
                  uri={profile?.profileImageUrl}
                  name={userDisplayName(item)}
                  size={48}
                  crop="face"
                  characterType={profile?.type ?? "fan"}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{userDisplayName(item)}</Text>
                  <Text style={styles.caption} numberOfLines={1}>
                    {item.statusMessage || "함께 이야기해요"}
                  </Text>
                </View>
                <Feather
                  name={active ? "check-circle" : "circle"}
                  size={24}
                  color={active ? colors.primary : colors.border}
                />
              </Pressable>
            );
          }}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.label}>그룹 이름</Text>
          <TextInput
            autoFocus
            accessibilityLabel="그룹 이름"
            placeholder="그룹 이름을 입력해주세요"
            placeholderTextColor={colors.mutedForeground}
            value={name}
            onChangeText={setName}
            maxLength={30}
            style={styles.input}
          />
          <Text style={[styles.caption, { textAlign: "right" }]}>
            {name.length}/30
          </Text>
          <Text style={styles.label}>방 분류</Text>
          <View style={styles.categories}>
            {categories.map(([key, label]) => (
              <Pressable
                key={key}
                onPress={() => setCategory(key)}
                accessibilityRole="radio"
                accessibilityState={{ checked: category === key }}
                style={[
                  styles.chip,
                  {
                    backgroundColor:
                      category === key ? colors.primary : colors.secondary,
                  },
                ]}
              >
                <Text
                  style={{
                    color:
                      category === key
                        ? colors.primaryForeground
                        : colors.foreground,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>참여자 {selected.length}명</Text>
          <Text style={styles.subtitle}>
            {friends
              .filter((friend) => selected.includes(friend.id))
              .map((friend) => userDisplayName(friend))
              .join(", ")}
          </Text>
          <Text style={styles.caption}>
            선택한 친구에게만 공개되는 그룹입니다.
          </Text>
        </ScrollView>
      )}
      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, spacing.lg) },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          disabled={
            createRoom.isPending ||
            !selected.length ||
            (step === 2 && !name.trim())
          }
          onPress={() => (step === 1 ? setStep(2) : void submit())}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.primary,
              opacity:
                !selected.length || (step === 2 && !name.trim())
                  ? 0.4
                  : pressed
                    ? interaction.pressedOpacity
                    : 1,
            },
          ]}
        >
          {createRoom.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text
              style={[typography.label, { color: colors.primaryForeground }]}
            >
              {step === 1 ? `다음 · ${selected.length}명` : "그룹 만들기"}
            </Text>
          )}
        </Pressable>
      </View>
      <UgcConsentPrompt {...consent.promptProps} />
    </KeyboardAvoidingView>
  );
}
const makeStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      gap: spacing.md,
    },
    iconButton: {
      minHeight: interaction.minTarget,
      minWidth: interaction.minTarget,
      alignItems: "center",
      justifyContent: "center",
    },
    title: { ...typography.heading, color: colors.foreground, flex: 1 },
    caption: { ...typography.caption, color: colors.mutedForeground },
    subtitle: {
      ...typography.body,
      color: colors.foreground,
      marginBottom: spacing.md,
    },
    content: { padding: spacing.xl, paddingBottom: spacing.xxl },
    input: {
      minHeight: 52,
      borderRadius: radii.control,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.lg,
      color: colors.foreground,
      fontSize: 16,
      marginBottom: spacing.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      padding: spacing.md,
      backgroundColor: colors.card,
      borderRadius: radii.control,
      marginTop: spacing.sm,
    },
    memberName: { ...typography.label, color: colors.foreground },
    empty: { paddingVertical: 48, alignItems: "center" },
    label: {
      ...typography.label,
      color: colors.foreground,
      marginTop: spacing.xl,
      marginBottom: spacing.md,
    },
    categories: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    chip: {
      minHeight: interaction.minTarget,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.pill,
      justifyContent: "center",
    },
    footer: { padding: spacing.lg, backgroundColor: colors.background },
    button: {
      minHeight: 52,
      borderRadius: radii.control,
      justifyContent: "center",
      alignItems: "center",
    },
  });
