import { useMemo } from "react";
import { useColors } from "@/hooks/useColors";
import { fonts, fontSizes, radii } from "@/constants/designSystem";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NeonBackdrop } from "@/components/NeonUI";
import { usePlayMode } from "@/hooks/usePlayMode";
import { useStarFeed, type StarFeedWritableKind } from "@/hooks/useStarFeed";
import { pickAndUploadImages, type UploadedImage } from "@/lib/uploadImage";
import { crossAlert } from "@/lib/crossAlert";

export default function FeedWriteScreen() {
  return <Redirect href={"/(tabs)/feed?compose=1" as never} />;
}

function LegacyFeedWriteScreen() {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ kind?: string }>();
  const { equippedStar, starProfiles } = usePlayMode();
  const initialKind: StarFeedWritableKind = params.kind === "star" ? "star" : "fan";
  const [kind, setKind] = React.useState<StarFeedWritableKind>(initialKind);
  const [body, setBody] = React.useState("");
  const [media, setMedia] = React.useState<UploadedImage[]>([]);
  const [targetStarProfileId, setTargetStarProfileId] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const { createPost, isCreatingPost } = useStarFeed("recommended");
  const starWritable = equippedStar?.stage === "promoted";
  const effectiveKind: StarFeedWritableKind = kind === "star" && !starWritable ? "fan" : kind;
  const canSubmit = body.trim().length > 0 && !uploading && !isCreatingPost;

  const addImages = async () => {
    if (uploading || media.length >= 4) return;
    setUploading(true);
    try {
      const selected = await pickAndUploadImages();
      if (selected) setMedia((current) => [...current, ...selected].slice(0, 4));
    } catch {
      crossAlert("업로드 실패", "이미지를 업로드하지 못했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await createPost({
        kind: effectiveKind,
        body: body.trim(),
        media: media.map((item) => ({ objectPath: item.objectPath, mediaType: "image" })),
        targetStarProfileId: effectiveKind === "fan" ? targetStarProfileId : null,
      });
      router.replace("/(tabs)/feed" as never);
    } catch {
      crossAlert("게시 실패", "게시글을 올리지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  return (
    <NeonBackdrop style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="피드로 돌아가기">
          <Feather name="arrow-left" size={24} color={styleColors.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>피드 글쓰기</Text>
        <Pressable disabled={!canSubmit} onPress={() => void submit()} style={{ opacity: canSubmit ? 1 : 0.4 }}>
          <Text style={styles.publishText}>{isCreatingPost ? "게시 중" : "게시"}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.modeRow}>
          {(["star", "fan"] as const).map((item) => {
            const disabled = item === "star" && !starWritable;
            const active = effectiveKind === item;
            return (
              <Pressable key={item} disabled={disabled} onPress={() => setKind(item)} style={[styles.modeButton, active && styles.modeButtonActive, disabled && styles.disabled]}>
                {disabled ? <Feather name="lock" size={12} color={styleColors.mutedForeground} /> : null}
                <Text style={[styles.modeText, active && styles.modeTextActive]}>{item === "star" ? "STAR 기록" : "FAN 이야기"}</Text>
              </Pressable>
            );
          })}
        </View>
        {kind === "star" && !starWritable ? <Text style={styles.notice}>공식 STAR 승급 후 STAR 기록을 작성할 수 있어 FAN 작성 화면으로 전환했습니다.</Text> : null}
        <TextInput value={body} onChangeText={setBody} multiline maxLength={500} autoFocus placeholder={effectiveKind === "star" ? "STAR의 활동과 성장 기록을 남겨주세요." : "응원과 팬 이야기를 남겨주세요."} placeholderTextColor={styleColors.mutedForeground} style={styles.input} />
        {effectiveKind === "fan" && starProfiles.length > 0 ? (
          <View style={styles.targetSection}>
            <Text style={styles.targetLabel}>응원할 STAR (선택)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.targetRow}>
              <Pressable onPress={() => setTargetStarProfileId(null)} style={[styles.targetChip, targetStarProfileId === null && styles.targetChipActive]}>
                <Text style={[styles.targetText, targetStarProfileId === null && styles.targetTextActive]}>선택 안 함</Text>
              </Pressable>
              {starProfiles.map((star) => (
                <Pressable key={star.id} onPress={() => setTargetStarProfileId(star.id)} style={[styles.targetChip, targetStarProfileId === star.id && styles.targetChipActive]}>
                  <Text style={[styles.targetText, targetStarProfileId === star.id && styles.targetTextActive]} numberOfLines={1}>{star.displayName}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
        <View style={styles.counterRow}><Text style={styles.counter}>{body.length}/500</Text></View>
        <View style={styles.mediaRow}>
          <Pressable disabled={uploading || media.length >= 4} onPress={() => void addImages()} style={styles.mediaButton}>
            {uploading ? <ActivityIndicator color={styleColors.primary} /> : <Feather name="image" size={18} color={styleColors.primary} />}
            <Text style={styles.mediaButtonText}>사진 {media.length}/4</Text>
          </Pressable>
          {media.map((item) => <Pressable key={item.objectPath} onPress={() => setMedia((current) => current.filter((image) => image.objectPath !== item.objectPath))}><Image source={{ uri: item.localUri }} style={styles.preview} contentFit="cover" /></Pressable>)}
        </View>
      </ScrollView>
    </NeonBackdrop>
  );
}

const makeStyles = (styleColors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: { flex: 1 },
  header: { minHeight: 62, paddingHorizontal: 18, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: styleColors.border },
  headerTitle: { color: styleColors.foreground, fontSize: fontSizes.headingSmall, fontFamily: fonts.bold },
  publishText: { color: styleColors.primary, fontSize: fontSizes.body, fontFamily: "Inter_800ExtraBold" },
  content: { padding: 18, gap: 14 },
  modeRow: { flexDirection: "row", gap: 8 },
  modeButton: { flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: styleColors.border, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: styleColors.card },
  modeButtonActive: { borderColor: styleColors.primary, backgroundColor: styleColors.primary },
  disabled: { opacity: 0.45 },
  modeText: { color: styleColors.mutedForeground, fontSize: fontSizes.detail, fontFamily: fonts.bold },
  modeTextActive: { color: styleColors.foreground },
  notice: { color: styleColors.mutedForeground, fontSize: fontSizes.caption, lineHeight: 18, fontFamily: fonts.medium },
  targetSection: { gap: 8 },
  targetLabel: { color: styleColors.mutedForeground, fontSize: fontSizes.caption, fontFamily: fonts.bold },
  targetRow: { gap: 8, paddingRight: 12 },
  targetChip: { maxWidth: 160, minHeight: 36, paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, borderColor: styleColors.border, alignItems: "center", justifyContent: "center", backgroundColor: styleColors.card },
  targetChipActive: { borderColor: styleColors.primary, backgroundColor: styleColors.primary },
  targetText: { color: styleColors.mutedForeground, fontSize: fontSizes.caption, fontFamily: fonts.semibold },
  targetTextActive: { color: styleColors.foreground },
  input: { minHeight: 240, borderRadius: 18, borderWidth: 1, borderColor: styleColors.border, backgroundColor: styleColors.card, color: styleColors.foreground, padding: 16, textAlignVertical: "top", fontSize: fontSizes.body, lineHeight: 23, fontFamily: fonts.regular },
  counterRow: { alignItems: "flex-end", marginTop: -8 },
  counter: { color: styleColors.mutedForeground, fontSize: fontSizes.small, fontFamily: fonts.medium },
  mediaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  mediaButton: { width: 84, height: 76, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: styleColors.border, alignItems: "center", justifyContent: "center", gap: 6 },
  mediaButtonText: { color: styleColors.primaryForeground, fontSize: fontSizes.small, fontFamily: fonts.bold },
  preview: { width: 76, height: 76, borderRadius: radii.control },
});
