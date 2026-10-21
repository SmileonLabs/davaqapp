import React from "react";
import { ActivityIndicator, Keyboard, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { DAVAQ_LEGAL_LINK_ERROR } from "@/lib/davaqLegal";
import {
  DAVAQ_COMMUNITY_RELATED_LINKS,
  DAVAQ_COMMUNITY_RULES,
  DAVAQ_COMMUNITY_RULES_IS_DRAFT,
  DAVAQ_COMMUNITY_RULES_TITLE,
  DAVAQ_COMMUNITY_RULES_VERSION,
} from "@/lib/davaqCommunityRules";
import { UgcConsentController, type UgcConsentPromptState } from "@/lib/ugcConsent";

export type UgcConsentPromptProps = UgcConsentPromptState & {
  presentation?: "modal" | "inline";
  onAccept(explicitlyChecked: boolean): Promise<void>;
  onCancel(): void;
  onDismiss?(): void;
};

/** Render the prompt in its writing screen; do not mount a global navigation gate. */
export function useUgcConsent(
  ownerDbUserId: string | null | undefined,
  options?: { presentation?: "modal" | "inline" },
) {
  const presentation = options?.presentation ?? "modal";
  const [controller] = React.useState(() => new UgcConsentController());
  const owner = typeof ownerDbUserId === "string" && ownerDbUserId.trim() ? ownerDbUserId : null;
  const identity = React.useRef({ owner, generation: 0 });
  const mounted = React.useRef(true);
  const dismissTickets = React.useRef(new Set<{
    generation: number;
    shown: boolean;
    dismissed: boolean;
    invalidated: boolean;
    complete: ((dismissed: boolean) => void) | null;
  }>());
  if (identity.current.owner !== owner) {
    identity.current = { owner, generation: identity.current.generation + 1 };
  }
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  React.useEffect(() => {
    controller.setOwner(owner);
    for (const ticket of dismissTickets.current) {
      if (ticket.generation !== identity.current.generation) {
        ticket.invalidated = true; ticket.complete?.(false);
      }
    }
  }, [controller, owner]);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const ticket of dismissTickets.current) {
        ticket.invalidated = true; ticket.complete?.(false);
      }
      controller.dispose();
    };
  }, [controller]);
  const ensureConsent = React.useCallback(async () => {
    if (!mounted.current) return false;
    const requested = identity.current;
    controller.setOwner(requested.owner);
    const ticket = { generation: requested.generation, shown: false, dismissed: false,
      invalidated: false, complete: null as ((dismissed: boolean) => void) | null };
    dismissTickets.current.add(ticket);
    const observePrompt = () => {
      const prompt = controller.getSnapshot();
      if (prompt.visible && prompt.ownerId === requested.owner) ticket.shown = true;
    };
    observePrompt();
    const unsubscribe = controller.subscribe(observePrompt);
    try {
      const accepted = await controller.ensureConsent();
      if (!accepted || ticket.invalidated) return false;
      // iOS cannot safely present a sibling native Modal until this one has
      // finished dismissing. Existing local consent never opens a modal.
      if (presentation === "modal" && Platform.OS === "ios" && ticket.shown && !ticket.dismissed) {
        if (!(await new Promise<boolean>(resolve => { ticket.complete = resolve; }))) return false;
      }
      return !ticket.invalidated && identity.current.generation === requested.generation &&
        identity.current.owner === requested.owner;
    } finally {
      unsubscribe(); dismissTickets.current.delete(ticket);
    }
  }, [controller, presentation]);
  const onDismiss = React.useCallback(() => {
    if (controller.getSnapshot().visible) return;
    for (const ticket of dismissTickets.current) {
      if (ticket.shown && !ticket.invalidated) {
        ticket.dismissed = true; ticket.complete?.(true);
      }
    }
  }, [controller]);
  const shownGeneration = identity.current.generation;
  const isCurrentPrompt = () => mounted.current && identity.current.generation === shownGeneration &&
    state.visible && state.ownerId === owner;
  const promptProps: UgcConsentPromptProps = {
    ...state,
    visible: state.visible && state.ownerId === owner,
    presentation,
    onAccept: async checked => { if (isCurrentPrompt()) await controller.accept(checked); },
    onCancel: () => { if (isCurrentPrompt()) controller.cancel(); },
    onDismiss,
  };
  return { ensureConsent, promptProps };
}

export function UgcConsentPrompt({ ownerId, visible, busy, error, onAccept, onCancel, onDismiss, presentation = "modal" }: UgcConsentPromptProps) {
  const c = useColors(), insets = useSafeAreaInsets();
  const [checked, setChecked] = React.useState(false);
  const [showRules, setShowRules] = React.useState(false);
  const [linkError, setLinkError] = React.useState("");
  React.useEffect(() => {
    setChecked(false); setShowRules(false); setLinkError("");
    if (visible) Keyboard.dismiss();
  }, [ownerId, visible]);
  const close = () => { if (!busy) onCancel(); };
  const openRelatedPage = async (url: string) => {
    setLinkError("");
    try { await Linking.openURL(url); }
    catch { setLinkError(DAVAQ_LEGAL_LINK_ERROR); }
  };
  if (presentation === "inline" && !visible) return null;
  const content = <View style={[s.overlay, presentation === "inline" && s.inlineOverlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <View accessibilityViewIsModal style={[s.sheet, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={s.header}>
          <Text style={[s.title, { color: c.foreground }]}>작성 전에 확인해 주세요</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="규칙 동의 취소" disabled={busy} onPress={close} style={s.close}>
            <Feather name="x" size={22} color={c.foreground} />
          </Pressable>
        </View>
        <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
          <Text style={[s.copy, { color: c.mutedForeground }]}>카드·댓글·메시지와 사진을 올리기 전에 DAVAQ 이용 규칙을 확인해 주세요. 동의하지 않아도 카드와 피드를 둘러볼 수 있어요.</Text>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showRules }} onPress={() => setShowRules(value => !value)} style={s.link}>
            <Text style={[s.linkText, { color: c.foreground }]}>{showRules ? "규칙 전문 접기" : "커뮤니티·이용 규칙 전체 보기"}</Text>
            <Feather name={showRules ? "chevron-up" : "chevron-down"} size={18} color={c.foreground} />
          </Pressable>
          {showRules && <View style={[s.rules, { borderColor: c.border, backgroundColor: c.muted }]}>
            <Text style={[s.ruleTitle, { color: c.foreground }]}>{DAVAQ_COMMUNITY_RULES_TITLE}</Text>
            <Text style={[s.small, { color: c.mutedForeground }]}>{DAVAQ_COMMUNITY_RULES_VERSION}{DAVAQ_COMMUNITY_RULES_IS_DRAFT ? " · 운영자 검토용 초안" : ""}</Text>
            {DAVAQ_COMMUNITY_RULES.map(section => <View key={section.title} style={{ gap: 8 }}>
              <Text style={[s.ruleTitle, { color: c.foreground }]}>{section.title}</Text>
              {section.paragraphs.map(paragraph => <Text key={paragraph} selectable style={[s.copy, { color: c.foreground }]}>{paragraph}</Text>)}
            </View>)}
            {DAVAQ_COMMUNITY_RELATED_LINKS.map(link => <Pressable key={link.url} accessibilityRole="link" onPress={() => void openRelatedPage(link.url)} style={s.link}>
              <Text style={[s.linkText, { color: c.foreground }]}>{link.label}</Text>
            </Pressable>)}
          </View>}
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled: busy }} disabled={busy} onPress={() => setChecked(value => !value)} style={s.checkRow}>
            <Feather name={checked ? "check-square" : "square"} size={24} color={c.foreground} />
            <Text style={[s.copy, { color: c.foreground, flex: 1 }]}>만 13세 이상이며, 커뮤니티·이용 규칙을 확인하고 동의합니다.</Text>
          </Pressable>
          <Text style={[s.small, { color: c.mutedForeground }]}>동의는 현재 기기의 이 DAVAQ 계정에 저장돼요. 다른 기기나 규칙 변경 후에는 다시 확인할 수 있어요.</Text>
          {!!(error || linkError) && <Text accessibilityRole="alert" style={[s.copy, { color: c.destructive }]}>{error || linkError}</Text>}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !checked || busy, busy }} disabled={!checked || busy} onPress={() => void onAccept(checked)} style={[s.button, { backgroundColor: c.primary, opacity: !checked || busy ? 0.5 : 1 }]}>
            {busy ? <ActivityIndicator color={c.primaryForeground} /> : <Text style={{ color: c.primaryForeground, fontWeight: "700" }}>동의하고 계속</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={close} style={s.button}>
            <Text style={{ color: c.mutedForeground }}>지금은 취소</Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>;
  if (presentation === "inline") return content;
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close} onDismiss={onDismiss}>{content}</Modal>;
}
const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)", paddingHorizontal: 16 },
  inlineOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000, elevation: 1000 },
  sheet: { width: "100%", maxWidth: 560, alignSelf: "center", maxHeight: "100%", borderWidth: 1, borderRadius: 20, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 20, paddingRight: 8, paddingTop: 6 },
  title: { fontSize: 19, fontWeight: "700", flex: 1 },
  close: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingTop: 8, gap: 14 },
  copy: { fontSize: 14, lineHeight: 22 },
  small: { fontSize: 12, lineHeight: 19 },
  ruleTitle: { fontSize: 15, lineHeight: 22, fontWeight: "700" },
  rules: { padding: 14, borderWidth: 1, borderRadius: 12, gap: 18 },
  link: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, gap: 8 },
  linkText: { fontSize: 14, textDecorationLine: "underline", flexShrink: 1 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 },
  button: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, paddingHorizontal: 16 },
});
