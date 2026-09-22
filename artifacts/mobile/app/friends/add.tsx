import { CustomScrollView } from "@/components/CustomScroll";
import React, { useState, useEffect } from "react";
import { useLocalSearchParams } from "expo-router";
import { clearPendingInvite, inviteLink, parseInviteCode } from "@/lib/inviteLinks";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListFriendsQueryKey,
  getListOutgoingFriendRequestsQueryKey,
  useCreateInvite,
  useListFriends,
  useListOutgoingFriendRequests,
  useListUsers,
  useRedeemInvite,
  useSearchUsers,
  useSendFriendRequest,
} from "@workspace/api-client-react";
import { crossAlert } from "@/lib/crossAlert";
import { Avatar } from "@/components/Avatar";
import { useColors } from "@/hooks/useColors";

export default function AddFriendScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const {code}=useLocalSearchParams<{code?:string}>();
  const [inviteCode, setInviteCode] = useState("");
  useEffect(()=>{if(code){setInviteCode(parseInviteCode(code)??"");void clearPendingInvite();}},[code]);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  const [searchText,setSearchText]=useState("");
  useEffect(()=>{const timer=setTimeout(()=>setSearchText(email.trim()),250);return()=>clearTimeout(timer);},[email]);
  const trimmedEmail = searchText;
  const shouldSearch = trimmedEmail.length >= 2;

  const { data: searchResults = [], isFetching: searching } = useSearchUsers(
    { email: trimmedEmail || " " },
    { query: { enabled: shouldSearch } } as any,
  );

  const { data: allUsers = [], isFetching: loadingUsers } = useListUsers({
    query: { enabled: !shouldSearch },
  } as any);
  const { data: friends = [] } = useListFriends();
  const { data: outgoing = [] } = useListOutgoingFriendRequests();

  const excludedIds = React.useMemo(() => {
    const ids = new Set<string>();
    friends.forEach((f) => ids.add(f.id));
    outgoing.forEach((r) => ids.add(r.toUserId));
    return ids;
  }, [friends, outgoing]);

  const availableUsers = React.useMemo(
    () => allUsers.filter((u) => !excludedIds.has(u.id)),
    [allUsers, excludedIds],
  );

  const sendRequest = useSendFriendRequest();
  const createInvite = useCreateInvite();
  const redeemInvite = useRedeemInvite();

  const handleSendRequest = async (toUserId: string, nickname: string) => {
    if (requestingId || sentIds.has(toUserId)) return;
    setRequestingId(toUserId);
    try {
      const result = await sendRequest.mutateAsync({ data: { toUserId } });
      setSentIds((prev) => new Set(prev).add(toUserId));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListOutgoingFriendRequestsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListFriendsQueryKey() }),
      ]);
      // The other person had already requested me, so the server auto-accepted —
      // we're now friends rather than having sent a pending request.
      if (result?.status === "accepted") {
        crossAlert("완료", `${nickname}님과 친구가 되었습니다`);
      } else {
        crossAlert("완료", `${nickname}님에게 친구 요청을 보냈습니다`);
      }
    } catch {
      crossAlert("오류", "이미 친구 요청을 보냈거나 이미 친구입니다");
    } finally {
      setRequestingId(null);
    }
  };

  const renderRequestButton = (userId: string, nickname: string) => {
    const isLoading = requestingId === userId;
    const isSent = sentIds.has(userId);
    return (
      <Pressable
        style={({ pressed }) => [
          styles.reqBtn,
          {
            backgroundColor: isSent ? colors.secondary : colors.primary,
            opacity: isLoading || pressed ? 0.7 : 1,
          },
        ]}
        onPress={() => handleSendRequest(userId, nickname)}
        disabled={isLoading || isSent}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={[styles.reqBtnText, isSent && { color: colors.primary }]}>
            {isSent ? "요청됨" : "요청"}
          </Text>
        )}
      </Pressable>
    );
  };

  const handleCreateInvite = async () => {
    try {
      const invite = await createInvite.mutateAsync(undefined as any);
      const link = inviteLink(invite.inviteCode);
      let copied = false;
      try {
        const Clipboard = await import("expo-clipboard");
        await Clipboard.setStringAsync(link);
        copied = true;
      } catch {}
      crossAlert(
        copied ? "초대 링크 복사됨" : "초대 링크 생성됨",
        `${link}\n\n7일간 유효합니다`,
      );
    } catch {
      crossAlert("오류", "초대 링크 생성에 실패했습니다");
    }
  };

  const handleRedeemInvite = async () => {
    const normalized=parseInviteCode(inviteCode);
    if (!normalized || redeemInvite.isPending) { if(!normalized) crossAlert("초대 확인", "초대 코드나 DavaQ 초대 링크를 입력해 주세요."); return; }
    try {
      await redeemInvite.mutateAsync({ data: { inviteCode: normalized } });
      crossAlert("완료", "친구 요청을 보냈습니다");
      setInviteCode("");
      await Promise.all([queryClient.invalidateQueries({queryKey:getListFriendsQueryKey()}),queryClient.invalidateQueries({queryKey:getListOutgoingFriendRequestsQueryKey()})]);
    } catch {
      crossAlert("오류", "유효하지 않거나 만료된 초대 코드입니다");
    }
  };

  return (
    <CustomScrollView style={[styles.container, { backgroundColor: colors.background }]} keyboardShouldPersistTaps="handled">
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>이메일로 검색</Text>
        <View style={[styles.searchRow, { backgroundColor: colors.input }]}>
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            value={email}
            onChangeText={setEmail}
            placeholder="이메일 주소 입력"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          {searching && <ActivityIndicator size="small" color={colors.primary} />}
        </View>
        {shouldSearch && searchResults.length === 0 && !searching ? (
          <Text style={[styles.noResult, { color: colors.mutedForeground }]}>검색 결과가 없습니다</Text>
        ) : null}
        {shouldSearch && searchResults.map((user) => (
          <View key={user.id} style={[styles.userRow, { borderBottomColor: colors.border }]}>
            <Avatar uri={user.profileImageUrl} name={user.nickname} size={44} crop="face" characterType={user.profile?.type} />
            <View style={styles.userInfo}>
              <Text style={[styles.userName, { color: colors.foreground }]}>{user.nickname}</Text>
              <Text style={[styles.userEmail, { color: colors.mutedForeground }]}>{user.statusMessage || "DavaQ 사용자"}</Text>
            </View>
            {renderRequestButton(user.id, user.nickname)}
          </View>
        ))}
      </View>

      {!shouldSearch ? (
        <View style={[styles.section, { borderTopColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            전체 회원 {availableUsers.length > 0 ? `(${availableUsers.length})` : ""}
          </Text>
          {loadingUsers && availableUsers.length === 0 ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ paddingVertical: 12 }} />
          ) : null}
          {!loadingUsers && availableUsers.length === 0 ? (
            <Text style={[styles.noResult, { color: colors.mutedForeground }]}>추가할 수 있는 회원이 없습니다</Text>
          ) : null}
          {availableUsers.map((user) => (
            <View key={user.id} style={[styles.userRow, { borderBottomColor: colors.border }]}>
              <Avatar uri={user.profileImageUrl} name={user.nickname} size={44} crop="face" characterType={user.profile?.type} />
              <View style={styles.userInfo}>
                <Text style={[styles.userName, { color: colors.foreground }]}>{user.nickname}</Text>
                <Text style={[styles.userEmail, { color: colors.mutedForeground }]}>{user.statusMessage || "DavaQ 사용자"}</Text>
              </View>
              {renderRequestButton(user.id, user.nickname)}
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.section, { borderTopColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>초대 링크</Text>
        <Pressable
          style={({ pressed }) => [
            styles.inviteBtn,
            { backgroundColor: colors.secondary, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
          onPress={handleCreateInvite}
          disabled={createInvite.isPending}
        >
          {createInvite.isPending ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <Feather name="link" size={18} color={colors.primary} />
              <Text style={[styles.inviteBtnText, { color: colors.primary }]}>내 초대 링크 만들기</Text>
            </>
          )}
        </Pressable>
      </View>

      <View style={[styles.section, { borderTopColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>초대 코드 입력</Text>
        <View style={styles.codeRow}>
          <TextInput
            style={[styles.codeInput, { backgroundColor: colors.input, color: colors.foreground, borderColor: colors.border }]}
            value={inviteCode}
            onChangeText={setInviteCode}
            placeholder="초대 코드를 입력하세요"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
          />
          <Pressable
            style={({ pressed }) => [
              styles.redeemBtn,
              { backgroundColor: colors.primary, opacity: !inviteCode.trim() || redeemInvite.isPending || pressed ? 0.7 : 1 },
            ]}
            onPress={handleRedeemInvite}
            disabled={!inviteCode.trim() || redeemInvite.isPending}
          >
            <Text style={styles.redeemBtnText}>확인</Text>
          </Pressable>
        </View>
      </View>
    </CustomScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth, gap: 12 },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  noResult: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 8 },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  userInfo: { flex: 1, gap: 2 },
  userName: { fontSize: 15, fontFamily: "Inter_500Medium" },
  userEmail: { fontSize: 12, fontFamily: "Inter_400Regular" },
  reqBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  reqBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  inviteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  inviteBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  codeRow: { flexDirection: "row", gap: 10 },
  codeInput: { flex: 1, height: 48, borderRadius: 12, paddingHorizontal: 14, fontSize: 15, fontFamily: "Inter_400Regular", borderWidth: 1 },
  redeemBtn: { height: 48, paddingHorizontal: 18, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  redeemBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
