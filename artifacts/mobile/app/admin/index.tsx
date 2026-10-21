import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useKnowledgeAdminMe } from "@/hooks/useKnowledge";

type AdminLink = { label: string; description: string; icon: keyof typeof Feather.glyphMap; route?: string };
const links: AdminLink[] = [
  { label: "회원 관리", description: "회원 상태·활동·제재", icon: "users", route: "/admin/members" },
  { label: "공식 AI 계정", description: "공식 AI 계정과 채팅 운영", icon: "cpu", route: "/admin/ai-accounts" },
  { label: "IP·캐릭터", description: "IP 프로필과 캐릭터 에셋", icon: "user", route: "/admin/ip-profiles" },
  { label: "NFT 컬렉션", description: "컬렉션 등록·AI 분석·게시", icon: "box", route: "/settings/nft-admin" },
  { label: "Knowledge·온톨로지", description: "지식 소스와 검토 큐", icon: "database", route: "/settings/knowledge-admin" },
  { label: "피드·신고", description: "게시물과 신고 처리", icon: "flag", route: "/admin/moderation" },
  { label: "DavaQ 신고", description: "사용자·카드 댓글·채팅 신고", icon: "shield", route: "/admin/content-reports" },
  { label: "검색·추천", description: "인기 검색어와 차단어", icon: "search" },
  { label: "감사 로그", description: "관리자 작업 변경 이력", icon: "file-text" },
  { label: "관리자 권한", description: "역할과 접근 범위", icon: "shield", route: "/admin/roles" },
  { label: "감사 로그", description: "관리자 작업 이력", icon: "file-text", route: "/admin/audit-logs" },
  { label: "운영 현황", description: "피드·검색·채팅·통화", icon: "activity", route: "/admin/operations" },
];

export default function AdminHomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const { data: admin, isLoading } = useKnowledgeAdminMe();
  if (!isLoading && !admin?.isAdmin) return <View style={[styles.center, { backgroundColor: colors.background }]}><Feather name="lock" size={28} color={colors.mutedForeground} /><Text style={[styles.deniedTitle, { color: colors.foreground }]}>관리자 권한이 필요합니다</Text><Text style={[styles.deniedBody, { color: colors.mutedForeground }]}>관리자 계정으로 로그인한 뒤 다시 시도해 주세요.</Text></View>;
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}><Text style={[styles.title, { color: colors.foreground }]}>AnotherMe 관리자</Text><Text style={[styles.subtitle, { color: colors.mutedForeground }]}>회원·공식 AI·IP·콘텐츠를 한 곳에서 운영합니다.</Text><View style={styles.metrics}>{["처리 대기", "신고 대기", "AI 작업"].map((label) => <View key={label} style={[styles.metric, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.metricValue, { color: colors.primary }]}>—</Text><Text style={{ color: colors.mutedForeground }}>{label}</Text></View>)}</View><Text style={[styles.sectionTitle, { color: colors.foreground }]}>운영 메뉴</Text><View style={styles.grid}>{links.map((item) => <Pressable key={item.label} disabled={!item.route} onPress={() => item.route && router.push(item.route as never)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: item.route ? 1 : 0.58 }]}><Feather name={item.icon} size={20} color={colors.primary} /><Text style={[styles.cardTitle, { color: colors.foreground }]}>{item.label}</Text><Text style={[styles.cardDescription, { color: colors.mutedForeground }]}>{item.description}</Text>{!item.route ? <Text style={[styles.comingSoon, { color: colors.primary }]}>준비 중</Text> : null}</Pressable>)}</View></ScrollView>;
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 }, deniedTitle: { fontSize: 18, fontWeight: "700" }, deniedBody: { textAlign: "center", fontSize: 13 }, container: { padding: 18, gap: 14 }, title: { fontSize: 24, fontWeight: "800" }, subtitle: { fontSize: 13 }, metrics: { flexDirection: "row", gap: 8 }, metric: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 12, gap: 4 }, metricValue: { fontSize: 22, fontWeight: "800" }, sectionTitle: { fontSize: 18, fontWeight: "700", marginTop: 8 }, grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, card: { width: "48%", minHeight: 126, borderWidth: 1, borderRadius: 16, padding: 14, gap: 7 }, cardTitle: { fontSize: 15, fontWeight: "700" }, cardDescription: { fontSize: 11, lineHeight: 16 }, comingSoon: { fontSize: 11, marginTop: "auto" } });
