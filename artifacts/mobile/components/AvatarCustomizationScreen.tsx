import { useMemo } from "react";
import { useColors } from "@/hooks/useColors";
import { fonts, fontSizes, radii } from "@/constants/designSystem";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import {
  type AvatarCatalogItem,
  type AvatarSlot,
  useAvatarCatalog,
} from "@/hooks/useAvatarCatalog";
import { usePvtWallet } from "@/hooks/usePvtWallet";
import { buildAvatarRecipe, parseAvatarRecipe } from "@/lib/avatarAssets";
import { crossAlert } from "@/lib/crossAlert";

type AvatarCategory = "type" | AvatarSlot;
type FeatherName = React.ComponentProps<typeof Feather>["name"];

const CATEGORY_LABEL: Record<AvatarCategory, string> = {
  type: "타입",
  background: "배경",
  base: "베이스",
  head: "헤어",
  wear: "의상",
  effect: "이펙트",
  full_skin: "클래스 스킨",
  star_form: "성장 형태",
};

const CATEGORY_ICON: Record<AvatarCategory, FeatherName> = {
  type: "users",
  background: "image",
  base: "user",
  head: "smile",
  wear: "shopping-bag",
  effect: "zap",
  full_skin: "shield",
  star_form: "star",
};

const FAN_CATEGORIES: AvatarCategory[] = [
  "type",
  "background",
  "base",
  "head",
  "wear",
  "effect",
  "full_skin",
];
const STAR_CATEGORIES: AvatarCategory[] = ["background", "star_form", "effect"];
const CLASS_LEVEL = [1, 10, 30, 60];

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    return String((error as { data?: { error?: string } }).data?.error ?? "");
  }
  return error instanceof Error ? error.message : "";
}

export default function AvatarCustomizationScreen() {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profileId } = useLocalSearchParams<{ profileId?: string }>();
  const catalog = useAvatarCatalog(profileId);
  const wallet = usePvtWallet();
  const [category, setCategory] = React.useState<AvatarCategory>("type");
  const busy = catalog.isPurchasing || catalog.isEquipping;
  const data = catalog.data;
  const categories =
    data?.appearance.type === "star" ? STAR_CATEGORIES : FAN_CATEGORIES;

  React.useEffect(() => {
    if (!data) return;
    setCategory((current) => {
      const available =
        data.appearance.type === "star" ? STAR_CATEGORIES : FAN_CATEGORIES;
      return available.includes(current) ? current : available[0]!;
    });
  }, [data]);

  const genderOptions = React.useMemo(() => {
    if (!data || data.appearance.type !== "fan") return [];
    return (["woman", "man"] as const)
      .map((gender) =>
        data.items.find(
          (item) =>
            item.slot === "base" && item.gender === gender && item.isDefault,
        ),
      )
      .filter((item): item is AvatarCatalogItem => !!item);
  }, [data]);

  const items = React.useMemo(() => {
    if (!data) return [];
    if (category === "type") return genderOptions;
    return data.items.filter(
      (item) =>
        item.slot === category &&
        (!item.gender || item.gender === data.appearance.gender),
    );
  }, [category, data, genderOptions]);

  const previewRecipe = React.useCallback(
    (candidate: AvatarCatalogItem, typePreview = false) => {
      if (!data) return null;
      if (typePreview && candidate.gender) {
        return buildAvatarRecipe("fan", [
          "fan.background.001",
          candidate.itemKey,
          `fan.head.${candidate.gender}.001`,
          `fan.wear.${candidate.gender}.001`,
        ]);
      }

      const currentKeys = parseAvatarRecipe(data.appearance.recipe)?.keys ?? [];
      const byKey = new Map(data.items.map((item) => [item.itemKey, item]));
      let keys = currentKeys.filter(
        (key) => byKey.get(key)?.slot !== candidate.slot,
      );
      if (
        candidate.slot === "base" &&
        candidate.gender !== data.appearance.gender
      ) {
        keys = keys.filter(
          (key) =>
            !["head", "wear", "full_skin"].includes(byKey.get(key)?.slot ?? ""),
        );
        keys.push(
          `fan.head.${candidate.gender}.001`,
          `fan.wear.${candidate.gender}.001`,
        );
      }
      if (candidate.slot === "full_skin") {
        keys = keys.filter(
          (key) =>
            !["head", "wear", "effect"].includes(byKey.get(key)?.slot ?? ""),
        );
      }
      keys.push(candidate.itemKey);
      keys.sort(
        (a, b) =>
          (byKey.get(a)?.layerOrder ?? 0) - (byKey.get(b)?.layerOrder ?? 0),
      );
      return buildAvatarRecipe(data.appearance.type, keys);
    },
    [data],
  );

  const equip = async (item: AvatarCatalogItem) => {
    try {
      await catalog.equipItem(item.itemKey);
    } catch (error) {
      const code = errorCode(error);
      crossAlert(
        "장착할 수 없어요",
        code.includes("LOCKED")
          ? "현재 클래스에서 사용할 수 없는 아이템이에요."
          : "아이템 상태를 확인한 뒤 다시 시도해 주세요.",
      );
    }
  };

  const choose = (item: AvatarCatalogItem) => {
    if (!data || data.appearance.type === "star") return;
    if (category === "type" && item.gender === data.appearance.gender) return;
    if (item.classStage > data.appearance.classStage) {
      crossAlert(
        "아직 잠겨 있어요",
        `Class ${item.classStage} 달성 후 사용할 수 있어요.`,
      );
      return;
    }
    if (item.owned || item.isDefault || item.priceStarPoint === 0) {
      void equip(item);
      return;
    }
    crossAlert(
      "아바타 아이템 구매",
      `${item.displayName}을(를) ${item.priceStarPoint.toLocaleString()} STAR Point로 구매할까요?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "구매",
          onPress: () =>
            void (async () => {
              try {
                await catalog.purchaseItem(item.itemKey);
                await catalog.equipItem(item.itemKey);
              } catch (error) {
                crossAlert(
                  "구매할 수 없어요",
                  errorCode(error).includes("INSUFFICIENT")
                    ? "STAR Point가 부족해요."
                    : "잠시 후 다시 시도해 주세요.",
                );
              }
            })(),
        },
      ],
    );
  };

  if (catalog.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={styleColors.primary} />
        <Text style={styles.muted}>아바타를 불러오는 중이에요.</Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>아바타를 불러오지 못했어요.</Text>
        <Pressable
          onPress={() => void catalog.refetch()}
          style={styles.primary}
        >
          <Text style={styles.primaryText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityLabel="뒤로가기"
          hitSlop={12}
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={28} color={styleColors.foreground} />
        </Pressable>
        <Text style={styles.headerTitle}>아바타 꾸미기</Text>
        <View style={{ width: 28 }} />
      </View>

      <View
        style={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 10) + 14 },
        ]}
      >
        <View style={styles.balance}>
          <Text style={styles.balanceLabel}>보유 STAR Point</Text>
          <Text style={styles.balanceValue}>
            {(wallet.data?.balance ?? 0).toLocaleString()}
          </Text>
        </View>

        <View style={styles.workspace}>
          <View style={styles.previewColumn}>
            <View style={styles.hero}>
              <CharacterAvatar
                uri={data.appearance.recipe}
                crop="full"
                style={StyleSheet.absoluteFillObject}
              />
              {busy ? (
                <View style={styles.busy}>
                  <ActivityIndicator color={styleColors.foreground} />
                </View>
              ) : null}
            </View>
            <View style={styles.stageBadge}>
              <Text style={styles.stageText}>
                {data.appearance.type.toUpperCase()}
              </Text>
              <Text style={styles.stageClass}>
                Class {data.appearance.classStage}
              </Text>
            </View>
            <Text style={styles.previewHint}>
              아이템을 누르면 바로 적용돼요.
            </Text>
          </View>

          <View style={styles.selectorColumn}>
            <View style={styles.categoryGrid}>
              {categories.map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: category === item }}
                  onPress={() => setCategory(item)}
                  style={[
                    styles.categoryButton,
                    category === item && styles.categoryButtonActive,
                  ]}
                >
                  <Feather
                    name={CATEGORY_ICON[item]}
                    size={13}
                    color={category === item ? styleColors.primaryForeground : styleColors.mutedForeground}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.categoryText,
                      category === item && styles.categoryTextActive,
                    ]}
                  >
                    {CATEGORY_LABEL[item]}
                  </Text>
                </Pressable>
              ))}
            </View>

            {data.appearance.type === "star" ? (
              <Text style={styles.guide}>
                STAR 외형은 성장에 따라 자동 적용됩니다.
              </Text>
            ) : null}

            <View style={styles.itemHeader}>
              <Text style={styles.itemTitle}>{CATEGORY_LABEL[category]}</Text>
              <Text style={styles.itemCount}>{items.length}개</Text>
            </View>

            <ScrollView
              style={styles.itemScroll}
              contentContainerStyle={styles.grid}
              showsVerticalScrollIndicator={false}
            >
              {items.map((item) => {
                const isType = category === "type";
                const selected = isType
                  ? item.gender === data.appearance.gender
                  : item.equipped;
                const locked = item.classStage > data.appearance.classStage;
                const displayName = isType
                  ? item.gender === "woman"
                    ? "여성"
                    : "남성"
                  : item.displayName;
                const meta = selected
                  ? "선택됨"
                  : locked
                    ? `Lv.${CLASS_LEVEL[item.classStage] ?? "-"}`
                    : isType
                      ? "타입 변경"
                      : item.owned ||
                          item.isDefault ||
                          item.priceStarPoint === 0
                        ? "보유"
                        : `${item.priceStarPoint.toLocaleString()} STAR`;
                return (
                  <Pressable
                    key={isType ? `type-${item.gender}` : item.itemKey}
                    accessibilityRole="button"
                    accessibilityLabel={`${displayName} ${meta}`}
                    disabled={busy || data.appearance.type === "star"}
                    onPress={() => choose(item)}
                    style={[
                      styles.card,
                      selected && styles.cardActive,
                      locked && styles.cardLocked,
                    ]}
                  >
                    <View style={styles.cardPreview}>
                      <CharacterAvatar
                        uri={previewRecipe(item, isType)}
                        crop="full"
                        style={StyleSheet.absoluteFillObject}
                      />
                      {selected ? (
                        <View style={styles.selectedMark}>
                          <Feather name="check" size={11} color={styleColors.primaryForeground} />
                        </View>
                      ) : locked ? (
                        <View style={styles.lockedMark}>
                          <Feather name="lock" size={10} color={styleColors.mutedForeground} />
                        </View>
                      ) : null}
                    </View>
                    <Text numberOfLines={1} style={styles.cardName}>
                      {displayName}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.cardMeta, selected && styles.equipped]}
                    >
                      {meta}
                    </Text>
                  </Pressable>
                );
              })}
              {items.length === 0 ? (
                <Text style={styles.empty}>
                  선택할 수 있는 아이템이 없어요.
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (styleColors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: styleColors.background },
  center: {
    flex: 1,
    backgroundColor: styleColors.card,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 24,
  },
  header: {
    minHeight: 62,
    paddingHorizontal: 18,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: { color: styleColors.foreground, fontSize: fontSizes.titleMedium, fontWeight: "800" },
  title: { color: styleColors.foreground, fontSize: fontSizes.heading, fontWeight: "800" },
  muted: { color: styleColors.mutedForeground },
  content: { flex: 1, minHeight: 0, paddingHorizontal: 14, gap: 12 },
  balance: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: styleColors.border,
    backgroundColor: styleColors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  balanceLabel: { color: styleColors.mutedForeground, fontSize: fontSizes.caption },
  balanceValue: { color: styleColors.primary, fontSize: fontSizes.input, fontWeight: "900" },
  workspace: { flex: 1, minHeight: 0, flexDirection: "row", gap: 11 },
  previewColumn: {
    width: "42%",
    maxWidth: 250,
    minWidth: 118,
    flexShrink: 0,
    alignSelf: "flex-start",
    gap: 8,
  },
  hero: {
    width: "100%",
    aspectRatio: 0.7,
    borderRadius: radii.card,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: styleColors.border,
    backgroundColor: styleColors.card,
  },
  busy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: styleColors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  stageBadge: {
    minHeight: 44,
    borderRadius: 13,
    backgroundColor: styleColors.secondary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  stageText: { color: styleColors.primary, fontSize: fontSizes.caption, fontWeight: "900" },
  stageClass: {
    color: styleColors.primary,
    fontSize: fontSizes.tiny,
    fontWeight: "700",
    marginTop: 1,
  },
  previewHint: {
    color: styleColors.mutedForeground,
    fontSize: fontSizes.tiny,
    lineHeight: 14,
    textAlign: "center",
  },
  selectorColumn: { flex: 1, minWidth: 0, minHeight: 0 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  categoryButton: {
    width: "48%",
    minHeight: 34,
    borderWidth: 1,
    borderColor: styleColors.border,
    borderRadius: 10,
    backgroundColor: styleColors.card,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  categoryButtonActive: { backgroundColor: styleColors.primary, borderColor: styleColors.primary },
  categoryText: { color: styleColors.mutedForeground, fontSize: fontSizes.tiny, fontWeight: "700" },
  categoryTextActive: { color: styleColors.primaryForeground },
  guide: {
    color: styleColors.mutedForeground,
    fontSize: fontSizes.tiny,
    lineHeight: 15,
    backgroundColor: styleColors.card,
    borderRadius: 10,
    padding: 9,
    marginTop: 8,
  },
  itemHeader: {
    minHeight: 37,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  itemTitle: { color: styleColors.foreground, fontSize: fontSizes.label, fontWeight: "900" },
  itemCount: { color: styleColors.mutedForeground, fontSize: fontSizes.tiny },
  itemScroll: { flex: 1, minHeight: 0 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 7, paddingBottom: 18 },
  card: {
    width: "48%",
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: styleColors.border,
    backgroundColor: styleColors.card,
    overflow: "hidden",
    padding: 4,
    paddingBottom: 7,
  },
  cardActive: { borderColor: styleColors.primary, backgroundColor: styleColors.secondary },
  cardLocked: { opacity: 0.5 },
  cardPreview: {
    width: "100%",
    aspectRatio: 0.9,
    borderRadius: radii.small,
    overflow: "hidden",
    backgroundColor: styleColors.card,
  },
  selectedMark: {
    position: "absolute",
    right: 5,
    top: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: styleColors.primary,
  },
  lockedMark: {
    position: "absolute",
    right: 5,
    top: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: styleColors.card,
  },
  cardName: {
    color: styleColors.foreground,
    fontSize: fontSizes.tiny,
    fontWeight: "800",
    marginHorizontal: 4,
    marginTop: 6,
  },
  cardMeta: {
    color: styleColors.mutedForeground,
    fontSize: fontSizes.micro,
    marginHorizontal: 4,
    marginTop: 2,
  },
  equipped: { color: styleColors.primary, fontWeight: "800" },
  empty: { width: "100%", color: styleColors.mutedForeground, fontSize: fontSizes.small, lineHeight: 18 },
  primary: {
    backgroundColor: styleColors.primary,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  primaryText: { color: styleColors.primaryForeground, fontWeight: "800" },
});
