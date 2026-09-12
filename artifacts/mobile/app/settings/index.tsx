import { CustomScrollView } from "@/components/CustomScroll";
import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGetMe } from "@workspace/api-client-react";
import { crossAlert } from "@/lib/crossAlert";
import { Avatar } from "@/components/Avatar";
import { useColors } from "@/hooks/useColors";
import { gradientsDark } from "@/constants/colors";
import { useKnowledgeAdminMe } from "@/hooks/useKnowledge";
import { useCharacterProfiles } from "@/hooks/useCharacterProfiles";
import { clearChatOutboxForOwner } from "@/lib/chatMessageOutbox";

function ThemeSelector() {
  const colors = useColors();
  return (
    <View style={[styles.segment, { backgroundColor: colors.muted }]}>
      <View style={[styles.segmentItem, { backgroundColor: colors.background }]}>
        <Feather name="moon" size={16} color={colors.primary} />
        <Text style={[styles.segmentLabel, { color: colors.foreground }]}>다크 모드</Text>
      </View>
      <Text style={[styles.themeHint, { color: colors.mutedForeground }]}>모든 화면에 적용 중</Text>
    </View>
  );
}

function SettingsRow({
  icon,
  label,
  sublabel,
  onPress,
  destructive,
  last,
}: {
  icon: string;
  label: string;
  sublabel?: string;
  onPress: () => void;
  destructive?: boolean;
  last?: boolean;
}) {
  const colors = useColors();
  const tint = destructive ? colors.destructive : colors.primary;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        {
          opacity: pressed ? 0.6 : 1,
          borderBottomColor: colors.border,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
      onPress={onPress}
    >
      <View
        style={[
          styles.rowIcon,
          {
            backgroundColor: destructive
              ? colors.destructiveMuted
              : colors.accent,
          },
        ]}
      >
        <Feather name={icon as any} size={18} color={tint} />
      </View>
      <View style={styles.rowText}>
        <Text
          style={[
            styles.rowLabel,
            { color: destructive ? colors.destructive : colors.foreground },
          ]}
        >
          {label}
        </Text>
        {sublabel ? (
          <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
            {sublabel}
          </Text>
        ) : null}
      </View>
      {!destructive ? (
        <Feather
          name="chevron-right"
          size={18}
          color={colors.mutedForeground}
        />
      ) : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { signOut } = useAuth();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: me } = useGetMe();
  const { data: knowledgeAdmin } = useKnowledgeAdminMe();
  const { activeProfile } = useCharacterProfiles();

  const performLogout = async () => {
    const previousOwnerId = me?.id ?? null;
    // Clear before and after Clerk changes session state. The first removal
    // minimizes plaintext lifetime; the second is idempotent and closes the
    // window in which an already-settling request could finish during sign-out.
    if (previousOwnerId) {
      await clearChatOutboxForOwner(previousOwnerId).catch(() => undefined);
    }
    try {
      await signOut();
    } finally {
      if (previousOwnerId) {
        await clearChatOutboxForOwner(previousOwnerId).catch(() => undefined);
      }
    }
  };

  const handleLogout = () => {
    crossAlert("로그아웃", "정말 로그아웃하시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "로그아웃",
        style: "destructive",
        onPress: () => void performLogout(),
      },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.muted }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 8, backgroundColor: colors.muted },
        ]}
      >
        <Pressable
          accessibilityLabel="뒤로"
          hitSlop={8}
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backBtn,
            { opacity: pressed ? 0.5 : 1 },
          ]}
        >
          <Feather name="chevron-left" size={26} color={colors.primary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>설정</Text>
      </View>

      <CustomScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
      >
        {/* Profile card */}
        <Pressable
          onPress={() => router.push("/profile/edit")}
          style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
        >
          <LinearGradient
            colors={gradientsDark.soft}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.profile}
          >
            <Avatar
              uri={activeProfile?.profileImageUrl}
              name={activeProfile?.displayName ?? me?.nickname ?? "?"}
              size={60}
              crop="face"
              characterType={activeProfile?.type}
            />
            <View style={styles.profileInfo}>
              <Text
                style={[styles.profileName, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {me?.nickname ?? "내 프로필"}
              </Text>
              <Text
                style={[styles.profileEmail, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {me?.email ?? ""}
              </Text>
              {me?.statusMessage ? (
                <Text
                  style={[
                    styles.profileStatus,
                    { color: colors.mutedForeground },
                  ]}
                  numberOfLines={1}
                >
                  {me.statusMessage}
                </Text>
              ) : null}
            </View>
            <Feather
              name="chevron-right"
              size={20}
              color={colors.mutedForeground}
            />
          </LinearGradient>
        </Pressable>

        {/* Display section */}
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          화면
        </Text>
        <ThemeSelector />

        {/* DavaQ section */}
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          어나더 미
        </Text>
        <View style={[styles.section, { backgroundColor: colors.background }]}>
          <SettingsRow
            icon="user"
            label="어나더 미"
            sublabel="분석 데이터와 온톨로지 근거 보기"
            onPress={() => router.push("/settings/ontology" as never)}
          />
          <SettingsRow
            icon="message-circle"
            label="DavaQ 소환 설정"
            sublabel="답장이 늦을 때 AI 분신 소환 허용 범위"
            onPress={() => router.push("/settings/another-me" as never)}
          />
          <SettingsRow
            icon="database"
            label="내 AI 기억"
            sublabel="DavaQ가 참고할 기억 관리"
            onPress={() => router.push("/settings/ai-memories" as never)}
            last
          />
        </View>

        {knowledgeAdmin?.isAdmin ? (
          <>
            <Text
              style={[styles.sectionTitle, { color: colors.mutedForeground }]}
            >
              관리자
            </Text>
            <View
              style={[styles.section, { backgroundColor: colors.background }]}
            >
              <SettingsRow
                icon="cpu"
                label="AI 지식 관리자"
                sublabel="수집, review, 캠페인 관리"
                onPress={() =>
                  router.push("/settings/knowledge-admin" as never)
                }
                last
              />
              <SettingsRow
                icon="box"
                label="NFT 컬렉션 관리"
                sublabel="허용 IP 등록과 성장 RPG 초안 검토"
                onPress={() => router.push("/settings/nft-admin" as never)}
                last
              />
            </View>
          </>
        ) : null}

        {knowledgeAdmin?.isAdmin ? (
          <View style={[styles.section, { backgroundColor: colors.background }]}>
            <SettingsRow
              icon="grid"
              label="관리자 콘솔"
              sublabel="회원·공식 AI·IP·콘텐츠 운영"
              onPress={() => router.push("/admin" as never)}
              last
            />
          </View>
        ) : null}

        {/* Account section */}
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          계정
        </Text>
        <View style={[styles.section, { backgroundColor: colors.background }]}>
          <SettingsRow
            icon="bell"
            label="알림"
            sublabel="메시지 및 알림 설정"
            onPress={() => router.push("/settings/notifications")}
          />
          <SettingsRow
            icon="slash"
            label="차단한 사용자"
            sublabel="차단 목록 관리"
            onPress={() => router.push("/settings/blocked")}
          />
          <SettingsRow
            icon="share-2"
            label="초대 링크 만들기"
            sublabel="친구를 초대해보세요"
            onPress={() => router.push("/friends/add")}
            last
          />
        </View>

        <View
          style={[
            styles.section,
            { backgroundColor: colors.background, marginTop: 16 },
          ]}
        >
          <SettingsRow
            icon="log-out"
            label="로그아웃"
            onPress={handleLogout}
            destructive
            last
          />
        </View>
      </CustomScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  backBtn: { padding: 6, marginLeft: -6 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    marginHorizontal: 16,
    borderRadius: 18,
  },
  profileInfo: { flex: 1, gap: 2 },
  profileName: { fontSize: 18, fontFamily: "Inter_700Bold" },
  profileEmail: { fontSize: 13, fontFamily: "Inter_400Regular" },
  profileStatus: { fontSize: 13, fontFamily: "Inter_400Regular" },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 8,
  },
  section: {
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginHorizontal: 16,
    padding: 4,
    borderRadius: 14,
  },
  themeHint: {
    flex: 1,
    paddingHorizontal: 14,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textAlign: "right",
  },
  segmentItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 11,
  },
  segmentLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
