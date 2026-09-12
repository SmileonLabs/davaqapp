import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Avatar } from "@/components/Avatar";
import type { PersonaCard as PersonaCardData } from "@workspace/api-client-react";

/** Distinct accent gradient per archetype so each identity feels unique. */
const ARCHETYPE_GRADIENT: Record<string, readonly [string, string, ...string[]]> = {
  strategist: ["#4F7BF5", "#7C5CFC"],
  harmonizer: ["#FF6B9D", "#FB7185"],
  explorer: ["#00B488", "#22C7A9"],
  pioneer: ["#7C5CFC", "#9D5CFC"],
  sage: ["#3B82F6", "#0EA5E9"],
  entertainer: ["#F5A623", "#FB923C"],
  activist: ["#FB7185", "#F5A623"],
  observer: ["#64748B", "#94A3B8"],
  calm_persuader: ["#4F7BF5", "#00B488"],
  witty_communicator: ["#F5A623", "#7C5CFC"],
  persuasive_speaker: ["#7C5CFC", "#4F7BF5"],
  forming: ["#64748B", "#94A3B8"],
};

const DEFAULT_GRADIENT = ["#6E7CF0", "#5B6EE8"] as const;

interface PersonaCardOntologyProfile {
  confidence: number;
}

/**
 * Vertical, share-ready identity card. Pure presentation — it receives the
 * computed card data and renders it. (Download/export is intentionally not
 * implemented yet.)
 */
export function PersonaCard({
  card,
  avatarUri,
  avatarName,
  avatarCharacterType,
}: {
  card: PersonaCardData;
  avatarUri?: string | null;
  avatarName: string;
  avatarCharacterType?: "fan" | "star" | "official_ai" | string | null;
}) {
  const gradient = ARCHETYPE_GRADIENT[card.archetypeKey] ?? DEFAULT_GRADIENT;
  const ontologyProfile = (card as PersonaCardData & { ontologyProfile?: PersonaCardOntologyProfile | null }).ontologyProfile ?? null;
  const statusChip = ontologyProfile ? `신뢰도 ${ontologyProfile.confidence}%` : "동기화 오류";

  return (
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.watermark}>
        <Feather name="zap" size={120} color="rgba(255,255,255,0.10)" />
      </View>

      <View style={styles.header}>
        <View style={styles.avatarRing}>
          <Avatar
            uri={avatarUri}
            name={avatarName}
            size={64}
            crop="face"
            characterType={avatarCharacterType ?? "fan"}
          />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.name} numberOfLines={1}>
            {card.name}
          </Text>
          <View style={styles.levelRow}>
            <View style={styles.levelChip}>
              <Text style={styles.levelChipText}>{statusChip}</Text>
            </View>
            <Text style={styles.title} numberOfLines={1}>
              {card.title}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.archetypeBadge}>
        <Feather name="award" size={14} color="#fff" />
        <Text style={styles.archetypeText}>{card.archetype}</Text>
      </View>

      {card.primaryTraits.length > 0 ? (
        <View style={styles.traitRow}>
          {card.primaryTraits.map((t) => (
            <View key={t} style={styles.traitChip}>
              <Text style={styles.traitText}>{t}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {card.strengths.length > 0 ? (
        <View style={styles.strengthsBlock}>
          <Text style={styles.blockLabel}>대표 강점</Text>
          <View style={styles.strengthRow}>
            {card.strengths.map((s) => (
              <View key={s} style={styles.strengthItem}>
                <Feather name="star" size={12} color="#fff" />
                <Text style={styles.strengthText}>{s}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.divider} />
      <Text style={styles.motto}>“{card.motto}”</Text>
      <Text style={styles.brand}>DavaQ 동기화</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    borderRadius: 24,
    padding: 22,
    overflow: "hidden",
  },
  watermark: {
    position: "absolute",
    right: -18,
    bottom: -18,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatarRing: {
    padding: 3,
    borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  headerText: { flex: 1, gap: 6, minWidth: 0 },
  name: { color: "#fff", fontSize: 18, fontFamily: "Inter_700Bold" },
  levelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  levelChip: {
    backgroundColor: "rgba(255,255,255,0.25)",
    flexShrink: 0,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 9,
  },
  levelChipText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
  title: { color: "rgba(255,255,255,0.92)", fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },

  archetypeBadge: {
    flexDirection: "row",
    alignSelf: "flex-start",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.18)",
    maxWidth: "100%",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    marginTop: 18,
  },
  archetypeText: { color: "#fff", flexShrink: 1, fontSize: 15, fontFamily: "Inter_700Bold" },

  traitRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  traitChip: {
    backgroundColor: "rgba(255,255,255,0.14)",
    flexShrink: 1,
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9,
  },
  traitText: { color: "rgba(255,255,255,0.95)", flexShrink: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },

  strengthsBlock: { marginTop: 18, gap: 8 },
  blockLabel: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
  },
  strengthRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  strengthItem: { flexDirection: "row", alignItems: "center", flexShrink: 1, gap: 5, maxWidth: "100%" },
  strengthText: { color: "#fff", flexShrink: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 19 },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.25)",
    marginTop: 20,
    marginBottom: 14,
  },
  motto: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    lineHeight: 19,
    fontStyle: "italic",
  },
  brand: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
    marginTop: 12,
    textAlign: "right",
  },
});
