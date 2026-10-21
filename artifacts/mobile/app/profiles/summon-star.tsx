import { useMemo } from "react";
import { useColors } from "@/hooks/useColors";
import { fonts, fontSizes, radii } from "@/constants/designSystem";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NeonBackdrop } from "@/components/NeonUI";
import { StarLockCard } from "@/components/StarLockCard";
import { useCharacterProfiles } from "@/hooks/useCharacterProfiles";
import { crossAlert } from "@/lib/crossAlert";

export default function SummonStarScreen() {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refetch, activateProfile } = useCharacterProfiles();
  const goBack = React.useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/profiles" as never);
  }, [router]);

  const finish = async (profileId: string) => {
    try {
      await refetch();
      await activateProfile(profileId);
      crossAlert("STAR 소환 완료", "새 STAR 프로필로 전환했습니다.", [
        { text: "확인", onPress: () => router.replace("/profiles" as never) },
      ]);
    } catch {
      crossAlert(
        "STAR 소환 완료",
        "소환은 완료됐지만 프로필 목록 갱신이 늦어지고 있어요. 목록에서 다시 확인해 주세요.",
        [{ text: "프로필 보기", onPress: () => router.replace("/profiles" as never) }],
      );
    }
  };

  return (
    <NeonBackdrop style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="프로필 관리로 돌아가기"
          hitSlop={12}
          onPress={goBack}
        >
          <Feather name="arrow-left" size={29} color={styleColors.foreground} />
        </Pressable>
        <Text style={styles.title}>NFT 연결 · STAR 소환</Text>
        <View style={{ width: 29 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        <View style={styles.guide}>
          <Text style={styles.guideTitle}>소환 절차</Text>
          <Text style={styles.guideText}>
            1. 지갑 연결 및 서명{"\n"}
            2. 허용 NFT 소유권 확인{"\n"}
            3. NFT 선택 후 STAR 소환
          </Text>
          <Text style={styles.guideNotice}>
            서명은 지갑 소유권 확인에만 사용되며 자산 전송 권한을 요청하지 않습니다.
          </Text>
        </View>
        <StarLockCard onSummoned={(profileId) => void finish(profileId)} />
      </ScrollView>
    </NeonBackdrop>
  );
}

const makeStyles = (styleColors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: styleColors.background },
  header: { minHeight: 62, paddingHorizontal: 18, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: styleColors.foreground, fontFamily: fonts.bold, fontSize: fontSizes.titleSmall },
  content: { paddingHorizontal: 18, gap: 16 },
  guide: { padding: 17, borderRadius: 18, borderWidth: 1, borderColor: styleColors.border, backgroundColor: styleColors.card, gap: 9 },
  guideTitle: { color: styleColors.foreground, fontFamily: fonts.bold, fontSize: fontSizes.input },
  guideText: { color: styleColors.mutedForeground, fontSize: fontSizes.detail, lineHeight: 22 },
  guideNotice: { color: styleColors.mutedForeground, fontSize: fontSizes.small, lineHeight: 17 },
});
