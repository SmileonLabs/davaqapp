import { useMemo } from "react";
import { useColors } from "@/hooks/useColors";
import { fonts, fontSizes, radii } from "@/constants/designSystem";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { NeonBackdrop } from "@/components/NeonUI";
import { useCharacterProfiles } from "@/hooks/useCharacterProfiles";
import { buildAvatarRecipe } from "@/lib/avatarAssets";
import { crossAlert } from "@/lib/crossAlert";

const ONBOARDING_KEY = "anotherme.onboarding.v1";
type Gender = "man" | "woman";

function itemKey(
  kind: "base" | "head" | "wear",
  gender: Gender,
  variant: number,
) {
  return `fan.${kind}.${gender}.${String(variant).padStart(3, "0")}`;
}

function ChoiceRow({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  selected: number;
  onSelect: (value: number) => void;
}) {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  return (
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.choiceRow}
      >
        {Array.from({ length: count }, (_, index) => index + 1).map((value) => (
          <Pressable
            key={value}
            onPress={() => onSelect(value)}
            style={[styles.choice, selected === value && styles.choiceActive]}
          >
            <Text
              style={[
                styles.choiceText,
                selected === value && styles.choiceTextActive,
              ]}
            >
              {value}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export default function CreateFanAvatarScreen() {
  const styleColors = useColors();
  const styles = useMemo(() => makeStyles(styleColors), [styleColors]);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const { fanProfiles, createFanProfile, isCreatingFan } =
    useCharacterProfiles();
  const [displayName, setDisplayName] = React.useState("");
  const [handle, setHandle] = React.useState("");
  const [gender, setGender] = React.useState<Gender>("woman");
  const [base, setBase] = React.useState(1);
  const [head, setHead] = React.useState(1);
  const [wear, setWear] = React.useState(1);
  const canCreate =
    onboarding === "1" ||
    fanProfiles.length === 0 ||
    fanProfiles.some(
      (profile) => profile.status === "torimia" || profile.level >= 50,
    );
  const baseKey = itemKey("base", gender, base);
  const headKey = itemKey("head", gender, head);
  const wearKey = itemKey("wear", gender, wear);
  const recipe = buildAvatarRecipe("fan", [
    "fan.background.001",
    baseKey,
    headKey,
    wearKey,
  ]);

  const changeGender = (value: Gender) => {
    setGender(value);
    setBase(1);
    setHead(1);
    setWear(1);
  };
  const submit = async () => {
    if (!displayName.trim()) return;
    if (!canCreate) {
      crossAlert(
        "FAN 추가 잠김",
        "기존 FAN이 토르미아 또는 Lv.50에 도달하면 새 FAN을 추가할 수 있어요.",
      );
      return;
    }
    try {
      await createFanProfile({
        displayName: displayName.trim(),
        ...(handle.trim() ? { handle: handle.trim() } : {}),
        ...(onboarding === "1" ? { customizeDefault: true } : {}),
        customization: { gender, baseKey, headKey, wearKey },
      });
      if (onboarding === "1") {
        await AsyncStorage.setItem(ONBOARDING_KEY, "1");
        router.replace("/(tabs)" as never);
      } else router.replace("/profiles" as never);
    } catch (error) {
      const errorCode =
        error && typeof error === "object" && "data" in error
          ? (error as { data?: { error?: string } }).data?.error
          : null;
      const locked =
        errorCode === "FAN_EXPANSION_LOCKED" ||
        (error instanceof Error &&
          error.message.includes("FAN_EXPANSION_LOCKED"));
      crossAlert(
        "FAN 생성 안내",
        locked
          ? "기존 FAN이 토르미아 또는 Lv.50에 도달하면 새 FAN을 만들 수 있어요."
          : "FAN 캐릭터를 만들지 못했어요. 핸들과 입력값을 확인해 주세요.",
      );
    }
  };

  return (
    <NeonBackdrop style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityLabel="뒤로가기"
          hitSlop={12}
          onPress={() => router.back()}
        >
          <Feather name="chevron-left" size={28} color={styleColors.foreground} />
        </Pressable>
        <Text style={styles.title}>새 FAN 만들기</Text>
        <View style={{ width: 28 }} />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        <Text style={styles.lead}>
          {canCreate
            ? "캐릭터의 모습을 선택하세요. 생성 후에도 아바타 꾸미기에서 변경할 수 있어요."
            : "이름과 모습을 먼저 정할 수 있어요. FAN 추가는 기존 FAN이 토르미아 또는 Lv.50에 도달하면 열립니다."}
        </Text>
        <View style={styles.preview}>
          <CharacterAvatar
            uri={recipe}
            crop="full"
            style={StyleSheet.absoluteFillObject}
          />
        </View>
        <Text style={styles.label}>캐릭터 이름</Text>
        <TextInput
          editable={!isCreatingFan}
          value={displayName}
          onChangeText={setDisplayName}
          maxLength={30}
          placeholder="이름 입력"
          placeholderTextColor={styleColors.mutedForeground}
          style={styles.input}
        />
        <Text style={styles.label}>공개 핸들 (선택)</Text>
        <TextInput
          editable={!isCreatingFan}
          value={handle}
          onChangeText={setHandle}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={24}
          placeholder="fan-name"
          placeholderTextColor={styleColors.mutedForeground}
          style={styles.input}
        />
        <View style={styles.section}>
          <Text style={styles.label}>타입</Text>
          <View style={styles.genderRow}>
            {(["woman", "man"] as const).map((value) => (
              <Pressable
                key={value}
                onPress={() => changeGender(value)}
                style={[
                  styles.genderButton,
                  gender === value && styles.genderButtonActive,
                ]}
              >
                <Text
                  style={[
                    styles.genderText,
                    gender === value && styles.choiceTextActive,
                  ]}
                >
                  {value === "woman" ? "여성" : "남성"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <ChoiceRow
          label="베이스"
          count={2}
          selected={base}
          onSelect={setBase}
        />
        <ChoiceRow
          label="헤어"
          count={gender === "man" ? 6 : 5}
          selected={head}
          onSelect={setHead}
        />
        <ChoiceRow label="의상" count={6} selected={wear} onSelect={setWear} />
        <Pressable
          disabled={!canCreate || !displayName.trim() || isCreatingFan}
          onPress={() => void submit()}
          style={[
            styles.submit,
            (!canCreate || !displayName.trim() || isCreatingFan) &&
              styles.disabled,
          ]}
        >
          {isCreatingFan ? (
            <ActivityIndicator color={styleColors.foreground} />
          ) : (
            <>
              <Feather
                name={canCreate ? "star" : "lock"}
                size={18}
                color={styleColors.foreground}
              />
              <Text style={styles.submitText}>
                {canCreate ? "FAN 소환하기" : "추가 조건 미달"}
              </Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </NeonBackdrop>
  );
}

const makeStyles = (styleColors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: styleColors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  title: { color: styleColors.foreground, fontSize: fontSizes.titleSmall, fontWeight: "800" },
  content: { paddingHorizontal: 20, gap: 12 },
  lead: { color: styleColors.mutedForeground, fontSize: fontSizes.label, lineHeight: 21, marginBottom: 2 },
  preview: {
    alignSelf: "center",
    width: 245,
    height: 350,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: styleColors.border,
    overflow: "hidden",
    backgroundColor: styleColors.card,
    marginVertical: 4,
  },
  label: { color: styleColors.foreground, fontSize: fontSizes.detail, fontWeight: "700" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: styleColors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    color: styleColors.foreground,
    backgroundColor: styleColors.card,
  },
  section: { gap: 9, marginTop: 6 },
  choiceRow: { gap: 8, paddingRight: 16 },
  choice: {
    width: 46,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: styleColors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: styleColors.card,
  },
  choiceActive: { backgroundColor: styleColors.primary, borderColor: styleColors.primary },
  choiceText: { color: styleColors.mutedForeground, fontSize: fontSizes.detail, fontWeight: "700" },
  choiceTextActive: { color: styleColors.primaryForeground },
  genderRow: { flexDirection: "row", gap: 8 },
  genderButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: styleColors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  genderButtonActive: { backgroundColor: styleColors.primary, borderColor: styleColors.primary },
  genderText: { color: styleColors.mutedForeground, fontWeight: "800" },
  submit: {
    marginTop: 18,
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: styleColors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitText: { color: styleColors.primaryForeground, fontSize: fontSizes.body, fontWeight: "800" },
  disabled: { opacity: 0.45 },
});
