import { Feather } from "@expo/vector-icons";
import type { DungeonState } from "@workspace/api-client-react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { DungeonPartyStrip } from "@/components/DungeonPartyStrip";
import type { AnotherMeSession } from "@/hooks/useAnotherMe";
import { useColors } from "@/hooks/useColors";

export function ChatRoomContextBar({
  pinnedMessage,
  onOpenPinnedMessage,
  onUnpin,
  isDungeon,
  dungeon,
  enemyShakeToken,
  activeAnotherMeSession,
  otherDisplayName,
  anotherMeDismissPending,
  onDismissAnotherMe,
  canSummonAnotherMe,
  anotherMeSummonPending,
  onSummonAnotherMe,
}: {
  pinnedMessage?: { id: string; content: string } | null;
  onOpenPinnedMessage: (messageId: string) => void;
  onUnpin: () => void;
  isDungeon: boolean;
  dungeon: DungeonState | undefined;
  enemyShakeToken: number;
  activeAnotherMeSession: AnotherMeSession | null;
  otherDisplayName: string;
  anotherMeDismissPending: boolean;
  onDismissAnotherMe: () => void;
  canSummonAnotherMe: boolean;
  anotherMeSummonPending: boolean;
  onSummonAnotherMe: () => void;
}) {
  const colors = useColors();

  return (
    <>
      {pinnedMessage ? (
        <Pressable
          onPress={() => onOpenPinnedMessage(pinnedMessage.id)}
          style={({ pressed }) => [
            styles.pinnedBar,
            { backgroundColor: colors.card, borderBottomColor: colors.border, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <Feather name="bookmark" size={15} color={colors.primary} />
          <View style={styles.pinnedTextWrap}>
            <Text style={[styles.pinnedLabel, { color: colors.primary }]} numberOfLines={1}>
              고정 메시지
            </Text>
            <Text style={[styles.pinnedText, { color: colors.foreground }]} numberOfLines={1}>
              {pinnedMessage.content}
            </Text>
          </View>
          <Pressable
            hitSlop={8}
            onPress={(event) => {
              event.stopPropagation?.();
              onUnpin();
            }}
            style={({ pressed }) => [styles.pinnedClose, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Feather name="x" size={17} color={colors.mutedForeground} />
          </Pressable>
        </Pressable>
      ) : null}
      {isDungeon ? <DungeonPartyStrip data={dungeon} enemyShakeToken={enemyShakeToken} /> : null}
      {activeAnotherMeSession ? (
        <View style={[styles.anotherMeBanner, { backgroundColor: colors.card, borderColor: colors.primary }]}>
          <View style={[styles.anotherMeIcon, { backgroundColor: colors.accent }]}>
            <Feather name="cpu" size={17} color={colors.primary} />
          </View>
          <View style={styles.anotherMeBannerText}>
            <Text style={[styles.anotherMeBannerTitle, { color: colors.foreground }]}>
              {activeAnotherMeSession.isOwner
                ? "현재 내 AI persona가 대화 중입니다"
                : `${activeAnotherMeSession.ownerName ?? otherDisplayName} AI persona가 응답 중입니다`}
            </Text>
            <Text style={[styles.anotherMeBannerSub, { color: colors.mutedForeground }]}>
              AI 응답은 라벨로 표시되며 중요한 결정과 확인되지 않은 사실은 확정하지 않습니다.
            </Text>
          </View>
          {activeAnotherMeSession.canDismiss ? (
            <Pressable
              onPress={onDismissAnotherMe}
              disabled={anotherMeDismissPending}
              style={[styles.anotherMeAction, { backgroundColor: colors.primary, opacity: anotherMeDismissPending ? 0.6 : 1 }]}
            >
              <Text style={[styles.anotherMeActionText, { color: colors.primaryForeground }]}>
                {activeAnotherMeSession.isOwner ? "퇴장" : "종료"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : canSummonAnotherMe ? (
        <View style={[styles.summonCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.summonCopy}>
            <Text style={[styles.summonTitle, { color: colors.foreground }]}>{otherDisplayName}님이 아직 응답하지 않았어요</Text>
            <Text style={[styles.summonBody, { color: colors.mutedForeground }]}>DavaQ를 소환해 잠시 대화를 이어갈 수 있어요.</Text>
          </View>
          <Pressable
            onPress={onSummonAnotherMe}
            disabled={anotherMeSummonPending}
            style={[styles.summonButton, { backgroundColor: colors.primary, opacity: anotherMeSummonPending ? 0.6 : 1 }]}
          >
            {anotherMeSummonPending ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Feather name="message-circle" size={15} color={colors.primaryForeground} />
            )}
            <Text style={[styles.summonButtonText, { color: colors.primaryForeground }]}>소환하기</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  pinnedBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pinnedTextWrap: { flex: 1, minWidth: 0 },
  pinnedLabel: { fontSize: 11, fontFamily: "Inter_700Bold" },
  pinnedText: { marginTop: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  pinnedClose: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  anotherMeBanner: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  anotherMeIcon: { alignItems: "center", borderRadius: 15, height: 30, justifyContent: "center", width: 30 },
  anotherMeBannerText: { flex: 1, gap: 2 },
  anotherMeBannerTitle: { fontFamily: "Inter_700Bold", fontSize: 13 },
  anotherMeBannerSub: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 15 },
  anotherMeAction: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  anotherMeActionText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  summonCard: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  summonCopy: { flex: 1, gap: 3 },
  summonTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  summonBody: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  summonButton: { alignItems: "center", borderRadius: 999, flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 9 },
  summonButtonText: { fontFamily: "Inter_700Bold", fontSize: 12 },
});
