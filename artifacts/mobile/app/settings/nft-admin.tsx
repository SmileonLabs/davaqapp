import React from "react";
import { useAuth } from "@/lib/davaqAuth";
import { Redirect } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useNftAdmin } from "@/hooks/useNftAdmin";

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback = "-"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function RpgBlueprintSummary({ blueprint, colors }: { blueprint: Record<string, unknown> | null; colors: ReturnType<typeof useColors> }) {
  const [expanded, setExpanded] = React.useState(false);
  if (!blueprint) {
    return <Text style={{ color: colors.mutedForeground }}>아직 성장 RPG 테마가 생성되지 않았습니다.</Text>;
  }

  const stats = Array.isArray(blueprint.stats) ? blueprint.stats.map((item) => stringValue(item)).filter((item) => item !== "-") : [];
  const missions = Array.isArray(blueprint.missions) ? blueprint.missions.map(recordValue) : [];
  const stages = Array.isArray(blueprint.stages) ? blueprint.stages.map(recordValue) : [];

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold" }}>성장 RPG 생성 완료</Text>
      <Text style={{ color: colors.mutedForeground }}>스탯 {stats.length}개 · 미션 {missions.length}개 · 성장 단계 {stages.length}개</Text>
      <Pressable onPress={() => setExpanded((value) => !value)} style={[styles.small, { alignSelf: "flex-start", backgroundColor: colors.secondary }]}>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold" }}>{expanded ? "생성 내용 접기" : "생성 내용 전체 보기"}</Text>
      </Pressable>
      {expanded ? (
        <View style={{ gap: 14 }}>
          <View style={{ gap: 7 }}>
            <Text style={[styles.detailSectionTitle, { color: colors.foreground }]}>성장 스탯</Text>
            <View style={styles.chipRow}>
              {stats.map((stat) => <View key={stat} style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.background }]}><Text style={{ color: colors.foreground }}>{stat}</Text></View>)}
            </View>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={[styles.detailSectionTitle, { color: colors.foreground }]}>미션</Text>
            {missions.map((mission, index) => (
              <View key={`${stringValue(mission.title)}-${index}`} style={[styles.detailCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <View style={styles.detailHeader}>
                  <Text style={[styles.detailTitle, { color: colors.foreground }]}>{index + 1}. {stringValue(mission.title)}</Text>
                  <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold" }}>+{Number(mission.xp ?? 0)} XP</Text>
                </View>
                <Text style={[styles.detailBody, { color: colors.mutedForeground }]}>{stringValue(mission.description)}</Text>
              </View>
            ))}
          </View>
          <View style={{ gap: 8 }}>
            <Text style={[styles.detailSectionTitle, { color: colors.foreground }]}>레벨별 성장 단계</Text>
            {stages.map((stage, index) => {
              const traits = Array.isArray(stage.retainedTraits) ? stage.retainedTraits.map((item) => stringValue(item)).filter((item) => item !== "-") : [];
              return (
                <View key={`${stringValue(stage.stageKey)}-${index}`} style={[styles.detailCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <Text style={[styles.detailTitle, { color: colors.foreground }]}>Lv.{Number(stage.minLevel ?? 0)} · {stringValue(stage.title)}</Text>
                  <Text style={[styles.detailBody, { color: colors.mutedForeground }]}>{stringValue(stage.description)}</Text>
                  {traits.length ? <Text style={[styles.detailMeta, { color: colors.primary }]}>유지 특성: {traits.join(" · ")}</Text> : null}
                  {stage.imagePrompt ? <Text style={[styles.detailMeta, { color: colors.mutedForeground }]}>외형 생성 프롬프트: {stringValue(stage.imagePrompt)}</Text> : null}
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function NftAdminScreen() {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const colors = useColors();
  const { admin, collections, isLoading, create, analyze, rpgAnalyze, review } = useNftAdmin();
  const [form, setForm] = React.useState({ chainId: "56", contractAddress: "", rpcUrl: "", name: "", ipName: "", category: "character", officialUrl: "" });
  const [message, setMessage] = React.useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = React.useState<NonNullable<typeof analyze.data> | null>(null);
  React.useEffect(() => {
    if (analyze.data) setAnalysisResult(analyze.data);
  }, [analyze.data]);
  const submit = async () => {
    if (!form.contractAddress.trim() || !form.name.trim() || !form.ipName.trim()) return;
    try { await create.mutateAsync({ ...form, chainId: Number(form.chainId) || 1 }); setMessage("컬렉션을 등록했어요. AI 분석을 실행해 주세요."); setForm((value) => ({ ...value, contractAddress: "", name: "", ipName: "" })); } catch { setMessage("컬렉션 등록에 실패했어요."); }
  };
  if (!isAuthLoaded) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  if (admin && !admin.isAdmin) return <View style={[styles.center, { backgroundColor: colors.background }]}><Text style={{ color: colors.foreground }}>관리자 권한이 필요합니다.</Text></View>;
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
    <Text style={[styles.title, { color: colors.foreground }]}>NFT 컬렉션 관리</Text>
    <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>허용할 IP를 등록하고 AI 성장 RPG 초안을 검토합니다.</Text>
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {(["chainId", "contractAddress", "rpcUrl", "name", "ipName", "category", "officialUrl"] as const).map((key) => <TextInput key={key} value={form[key]} onChangeText={(value) => setForm((previous) => ({ ...previous, [key]: value }))} placeholder={key} placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} />)}
      <Pressable onPress={() => void submit()} disabled={create.isPending} style={[styles.primary, { backgroundColor: colors.primary }]}><Text style={{ color: colors.primaryForeground }}>{create.isPending ? "등록 중" : "컬렉션 등록"}</Text></Pressable>
      {message ? <Text style={[styles.message, { color: colors.primary }]}>{message}</Text> : null}
    </View>
    {isLoading ? <ActivityIndicator color={colors.primary} /> : collections.map((item) => <View key={item.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}><Text style={[styles.itemTitle, { color: colors.foreground }]}>{item.ipName} · {item.category}</Text><Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>{item.status} · {item.contractAddress}</Text><View style={styles.actions}><Pressable onPress={() => void analyze.mutateAsync(item.id)} style={[styles.small, { backgroundColor: colors.secondary }]}><Text style={{ color: colors.foreground }}>AI 분석</Text></Pressable>{item.status === "review_required" ? <Pressable onPress={() => void review.mutateAsync({ id: item.id, action: "approve" })} style={[styles.small, { backgroundColor: colors.primary }]}><Text style={{ color: colors.primaryForeground }}>승인</Text></Pressable> : null}{item.status === "approved" ? <Pressable onPress={() => void review.mutateAsync({ id: item.id, action: "publish" })} style={[styles.small, { backgroundColor: colors.primary }]}><Text style={{ color: colors.primaryForeground }}>게시</Text></Pressable> : null}</View></View>)}
    {analysisResult ? <View style={[styles.resultCard, { borderColor: colors.primary, backgroundColor: colors.card }]}><Text style={[styles.resultTitle, { color: colors.foreground }]}>AI 분석 결과</Text><Text style={{ color: colors.foreground }}>역할: {analysisResult.roleName ?? "-"}</Text><Text style={{ color: colors.mutedForeground }}>세계관: {analysisResult.worldStyle ?? "-"}</Text><Text style={{ color: colors.mutedForeground }}>상태: {analysisResult.status}</Text><Pressable onPress={() => setAnalysisResult(null)} style={[styles.small, { backgroundColor: colors.secondary }]}><Text style={{ color: colors.foreground }}>목록으로 돌아가기</Text></Pressable></View> : null}
    {collections.filter((item) => item.aiAnalyzedAt).map((item) => <View key={`analysis-${item.id}`} style={[styles.resultCard, { borderColor: colors.primary, backgroundColor: colors.card }]}><Text style={[styles.resultTitle, { color: colors.foreground }]}>저장된 AI 분석 · {item.ipName}</Text><Text style={{ color: colors.foreground }}>역할: {item.roleName ?? "-"}</Text><Text style={{ color: colors.mutedForeground }}>세계관: {item.worldStyle ?? "-"}</Text><Text style={{ color: colors.mutedForeground }}>분석일: {item.aiAnalyzedAt}</Text><RpgBlueprintSummary blueprint={item.rpgBlueprint} colors={colors} /><Pressable disabled={rpgAnalyze.isPending} onPress={() => void rpgAnalyze.mutateAsync(item.id)} style={[styles.primary, { backgroundColor: colors.primary, opacity: rpgAnalyze.isPending ? 0.5 : 1 }]}><Text style={{ color: colors.primaryForeground }}>{rpgAnalyze.isPending ? "성장 RPG 생성 중…" : "성장 RPG 테마 생성"}</Text></Pressable></View>)}
    {analyze.isPending ? <View style={[styles.busyOverlay, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.foreground }}>AI가 NFT IP와 성장 RPG를 분석 중입니다…</Text><Text style={{ color: colors.mutedForeground }}>완료될 때까지 잠시만 기다려 주세요.</Text></View> : null}
    {rpgAnalyze.isSuccess ? <Text style={[styles.message, { color: colors.primary }]}>성장 RPG 테마가 저장되었습니다. 아래 카드에서 미션과 성장 단계를 확인하세요.</Text> : null}
    {rpgAnalyze.isError ? <Text style={[styles.message, { color: colors.foreground }]}>성장 RPG 테마 생성에 실패했습니다. 잠시 후 다시 시도하세요.</Text> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({ container: { flex: 1, padding: 18, gap: 12, position: "relative" }, center: { flex: 1, alignItems: "center", justifyContent: "center" }, title: { fontSize: 22, fontFamily: "Inter_700Bold" }, subtitle: { fontSize: 12, lineHeight: 18 }, card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 9 }, resultCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 }, resultTitle: { fontSize: 18, fontFamily: "Inter_700Bold" }, busyOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 10, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 }, input: { minHeight: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11 }, primary: { borderRadius: 10, minHeight: 42, alignItems: "center", justifyContent: "center" }, message: { fontSize: 12 }, itemTitle: { fontSize: 15, fontFamily: "Inter_700Bold" }, itemMeta: { fontSize: 11 }, actions: { flexDirection: "row", gap: 8 }, small: { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8 }, detailSectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold" }, chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }, detailCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 7 }, detailHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }, detailTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold" }, detailBody: { fontSize: 12, lineHeight: 18 }, detailMeta: { fontSize: 11, lineHeight: 16 } });
