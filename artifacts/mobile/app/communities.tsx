import { useMemo } from "react";
import { useColors } from "@/hooks/useColors";
import { fonts, fontSizes, radii } from "@/constants/designSystem";
import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFanCommunities, useFanCommunityPrograms } from "@/hooks/useFanCommunities";
import { NeonBackdrop } from "@/components/NeonUI";

export default function CommunitiesScreen() {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const { communities, isLoading, toggleMembership, isMutating } = useFanCommunities();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ?? communities[0]?.id ?? null;
  const program = useFanCommunityPrograms(selected);
  const community = communities.find((item) => item.id === selected);
  return <NeonBackdrop style={styles.container}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>팬 커뮤니티</Text>
    {isLoading ? <ActivityIndicator color={styleColors.primary} /> : communities.length === 0 ? <Text style={styles.empty}>아직 공개된 커뮤니티가 없습니다.</Text> : communities.map((item) => <Pressable key={item.id} onPress={() => setSelectedId(item.id)} style={[styles.community, item.id === selected && styles.selected]}><View style={styles.row}><Feather name="users" size={18} color={styleColors.primary} /><Text style={styles.name}>{item.name}</Text></View><Text style={styles.description}>{item.description || "STAR와 함께하는 팬 공간"}</Text><Text style={styles.count}>{item.memberCount}명 참여</Text><Pressable disabled={isMutating} onPress={() => void toggleMembership({ id: item.id, joined: false })} style={styles.join}><Text style={styles.joinText}>가입/탈퇴</Text></Pressable></Pressable>)}
    {community ? <><Text style={styles.sectionTitle}>{community.name} 브로드캐스트</Text>{program.broadcasts.map((item) => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardBody}>{item.body}</Text></View>)}<Text style={styles.sectionTitle}>미션</Text>{program.missions.map((item) => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.cardBody}>{item.description}</Text><Pressable onPress={() => void program.joinMission(item.id)} style={styles.mission}><Text style={styles.joinText}>미션 참여</Text></Pressable></View>)}</> : null}
  </ScrollView></NeonBackdrop>;
}

const makeStyles = (styleColors: ReturnType<typeof useColors>) => StyleSheet.create({ container: { flex: 1 }, content: { padding: 20, gap: 12, paddingBottom: 100 }, title: { color: styleColors.foreground, fontSize: fontSizes.displaySmall, fontFamily: fonts.bold }, sectionTitle: { color: styleColors.mutedForeground, fontSize: fontSizes.heading, fontFamily: fonts.bold, marginTop: 12 }, community: { padding: 14, borderRadius: 16, backgroundColor: styleColors.card, borderWidth: 1, borderColor: styleColors.border }, selected: { borderColor: styleColors.primary }, row: { flexDirection: "row", gap: 8, alignItems: "center" }, name: { color: styleColors.foreground, fontFamily: fonts.bold, fontSize: fontSizes.input }, description: { color: styleColors.mutedForeground, marginTop: 6 }, count: { color: styleColors.mutedForeground, marginTop: 8, fontSize: fontSizes.caption }, join: { alignSelf: "flex-end", marginTop: 8, padding: 8, borderRadius: radii.small, backgroundColor: styleColors.primary }, joinText: { color: styleColors.primaryForeground, fontFamily: fonts.semibold, fontSize: fontSizes.caption }, empty: { color: styleColors.mutedForeground }, card: { padding: 14, borderRadius: 14, backgroundColor: styleColors.card, borderWidth: 1, borderColor: styleColors.border, gap: 6 }, cardTitle: { color: styleColors.foreground, fontFamily: fonts.bold }, cardBody: { color: styleColors.mutedForeground }, mission: { alignSelf: "flex-start", marginTop: 6, padding: 8, borderRadius: radii.small, backgroundColor: styleColors.primary } });
