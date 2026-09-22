import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { CustomScrollView } from "@/components/CustomScroll";
import { useColors } from "@/hooks/useColors";
import {
  useAnotherMeSettings,
  useGenerateAnotherMeToneProfile,
  useUpdateAnotherMeSettings,
  type AnotherMeToneSyncLevel,
} from "@/hooks/useAnotherMe";
import { crossAlert } from "@/lib/crossAlert";

const TONE_OPTIONS: Array<{
  value: AnotherMeToneSyncLevel;
  label: string;
  description: string;
}> = [
  { value: "LOW", label: "낮음", description: "AI 안내 말투 중심" },
  { value: "MEDIUM", label: "보통", description: "내 말투 일부 반영" },
  { value: "HIGH", label: "높음", description: "친구/가족방에 적합" },
];

function SettingSwitch({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>
          {label}
        </Text>
        <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#fff"
      />
    </View>
  );
}

export default function AnotherMeSettingsScreen() {
  const colors = useColors();
  const { data: settings, isLoading, refetch } = useAnotherMeSettings();
  const update = useUpdateAnotherMeSettings();
  const generateTone = useGenerateAnotherMeToneProfile();

  const patch = React.useCallback(
    async (body: Parameters<typeof update.mutateAsync>[0]) => {
      try {
        await update.mutateAsync(body);
        await refetch();
      } catch {
        await refetch();
        crossAlert("오류", "DavaQ 설정을 변경하지 못했습니다.");
      }
    },
    [refetch, update],
  );

  if (isLoading || !settings) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.muted }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.muted }]}>
      <CustomScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.hero,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
            <Feather name="message-circle" size={22} color={colors.primary} />
          </View>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>
            AI 소환
          </Text>
          <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
            답장이 늦어질 때, 내가 허용한 상대가 내 AI 분신을 잠시 소환해 대화를
            이어갈 수 있습니다.
          </Text>
        </View>

        <View style={[styles.section, { backgroundColor: colors.background }]}>
          <SettingSwitch
            label="AI 소환 허용"
            description="꺼져 있으면 어떤 채팅방에서도 소환되지 않습니다"
            value={settings.summonEnabled}
            onChange={(value) => void patch({ summonEnabled: value })}
          />
          <SettingSwitch
            label="민감 대화 응답 차단"
            description="송금, 계약, 인증번호, 주소 등은 직접 확인 요청으로 제한합니다"
            value={settings.sensitiveReplyBlocked}
            onChange={(value) => void patch({ sensitiveReplyBlocked: value })}
          />
          <SettingSwitch
            label="말투 싱크"
            description="내 평소 말투를 안전한 범위에서 반영합니다"
            value={settings.toneSyncEnabled}
            onChange={(value) => void patch({ toneSyncEnabled: value })}
          />
        </View>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          소환 가능한 상대
        </Text>
        <View style={[styles.section, { backgroundColor: colors.background }]}>
          <SettingSwitch
            label="친구 허용"
            description="친구 관계인 상대가 소환할 수 있습니다"
            value={settings.allowFriends}
            onChange={(value) => void patch({ allowFriends: value })}
          />
          <SettingSwitch
            label="모르는 사람 허용"
            description="기본값은 꺼짐입니다"
            value={settings.allowUnknown}
            onChange={(value) => void patch({ allowUnknown: value })}
          />
        </View>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          대기 시간
        </Text>
        <View
          style={[
            styles.waitCard,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <View style={[styles.waitBadge, { backgroundColor: colors.accent }]}>
            <Text style={[styles.waitBadgeText, { color: colors.primary }]}>
              30초
            </Text>
          </View>
          <View style={styles.waitTextBlock}>
            <Text style={[styles.waitTitle, { color: colors.foreground }]}>
              소환 대기 시간은 30초입니다
            </Text>
            <Text style={[styles.waitSub, { color: colors.mutedForeground }]}>
              상대가 마지막 메시지 이후 30초 동안 답장하지 않으면 DavaQ
              소환 카드가 표시됩니다.
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          말투 반영 수준
        </Text>
        <View style={styles.toneList}>
          {TONE_OPTIONS.map((option) => {
            const active = settings.defaultToneSyncLevel === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() =>
                  void patch({ defaultToneSyncLevel: option.value })
                }
                style={[
                  styles.toneCard,
                  {
                    backgroundColor: colors.background,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <View style={styles.toneText}>
                  <Text
                    style={[styles.toneLabel, { color: colors.foreground }]}
                  >
                    {option.label}
                  </Text>
                  <Text
                    style={[styles.toneSub, { color: colors.mutedForeground }]}
                  >
                    {option.description}
                  </Text>
                </View>
                {active ? (
                  <Feather
                    name="check-circle"
                    size={18}
                    color={colors.primary}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={async () => {
            try {
              await generateTone.mutateAsync("FRIEND");
              crossAlert(
                "완료",
                "최근 대화를 기반으로 말투 프로필을 업데이트했습니다.",
              );
            } catch {
              crossAlert("오류", "말투 프로필을 업데이트하지 못했습니다.");
            }
          }}
          disabled={generateTone.isPending}
          style={[
            styles.generateButton,
            {
              backgroundColor: colors.primary,
              opacity: generateTone.isPending ? 0.6 : 1,
            },
          ]}
        >
          {generateTone.isPending ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Feather
              name="refresh-cw"
              size={16}
              color={colors.primaryForeground}
            />
          )}
          <Text
            style={[styles.generateText, { color: colors.primaryForeground }]}
          >
            말투 프로필 업데이트
          </Text>
        </Pressable>
      </CustomScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { gap: 14, padding: 16, paddingBottom: 36 },
  hero: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    padding: 18,
  },
  heroIcon: {
    alignItems: "center",
    borderRadius: 16,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  heroTitle: { fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: -0.5 },
  heroBody: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20 },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    paddingHorizontal: 4,
  },
  section: { borderRadius: 16, overflow: "hidden" },
  row: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    padding: 16,
  },
  rowText: { flex: 1, gap: 3 },
  rowLabel: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  rowSub: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  waitCard: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  waitBadge: {
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  waitBadgeText: { fontFamily: "Inter_800ExtraBold", fontSize: 14 },
  waitTextBlock: { flex: 1, gap: 3 },
  waitTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  waitSub: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 },
  toneList: { gap: 8 },
  toneCard: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  toneText: { flex: 1, gap: 2 },
  toneLabel: { fontFamily: "Inter_700Bold", fontSize: 15 },
  toneSub: { fontFamily: "Inter_400Regular", fontSize: 12 },
  generateButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  generateText: { fontFamily: "Inter_700Bold", fontSize: 14 },
});
