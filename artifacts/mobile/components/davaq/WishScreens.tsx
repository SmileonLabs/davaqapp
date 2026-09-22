import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  View,
  useWindowDimensions,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { useMediaUri } from "@/hooks/useMediaUri";
import {
  api,
  categories,
  categoryName,
  errorText,
  key,
  useDavaq,
  useDavaqMutation,
  type Agent,
  type Listing,
  type Match,
  type Page,
} from "@/lib/davaq";
import { rotateForViewer, type RelayCandidate } from "@/lib/relay";
import {
  wishPath,
  wishStatus,
  type Wish,
  type WishCandidates,
  type WishDraft,
} from "@/lib/wishes";
import {
  Button as BaseButton,
  C,
  Chip,
  Cue,
  Empty,
  Field,
  Frame,
  Icon,
  Notice,
  QueryState,
  S,
  Section,
  Txt,
} from "./UI";

function Button({
  label,
  onPress,
  secondary = false,
  busy = false,
  disabled = false,
  icon,
  small = false,
  style,
}: React.ComponentProps<typeof BaseButton>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: small ? 40 : 50,
          borderRadius: small ? 12 : 16,
          paddingHorizontal: small ? 13 : 18,
          paddingVertical: 10,
          backgroundColor: secondary ? C.soft : C.purple,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 7,
          opacity: disabled && !busy ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? C.purple : C.white} />
      ) : icon ? (
        <Icon name={icon} size={18} color={secondary ? C.purple : C.white} />
      ) : null}
      <Txt
        bold
        size={small ? 13 : 15}
        color={secondary ? C.purple : C.white}
        style={{ flexShrink: 1, textAlign: "center" }}
      >
        {label}
      </Txt>
    </Pressable>
  );
}

export function WishEntry({ compact = false }: { compact?: boolean }) {
  const router = useRouter(),
    narrow = useWindowDimensions().width < 360;
  return (
    <View
      style={[
        S.card,
        {
          backgroundColor: C.soft,
          borderColor: "#DDD3FF",
          padding: compact ? 16 : 22,
        },
      ]}
    >
      <View style={[S.row, { alignItems: "flex-start" }]}>
        <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
          <Txt size={12} color={C.purple} bold>
            갖고 싶은 순간, Q
          </Txt>
          <Txt size={compact ? 19 : narrow ? 24 : 28} bold>
            사기 전에,{compact ? " " : "\n"}Q에게 먼저
          </Txt>
          <Txt color={C.muted} size={13}>
            갖고 싶은 것을 캡처해서 보내세요.{"\n"}내 물건·재능으로 바꿀 방법을
            찾아봐요.
          </Txt>
        </View>
        {!compact && !narrow && <Cue size={108} />}
      </View>
      <Button
        label="갖고 싶은 것 Q에게 보내기"
        icon="camera"
        onPress={() => router.push("/wishes/new" as never)}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="내 비공개 소원함 열기"
        onPress={() => router.push("/wishes" as never)}
        style={{ alignItems: "center", paddingVertical: 4 }}
      >
        <Txt size={13} color={C.purple} bold>
          내 소원함 보기 →
        </Txt>
      </Pressable>
    </View>
  );
}
function WishPhoto({
  imageKey,
  uri,
  large = false,
}: {
  imageKey?: string | null;
  uri?: string;
  large?: boolean;
}) {
  const savedUri = useMediaUri(imageKey);
  const source = uri ?? savedUri;
  if (!source) return null;
  return (
    <Image
      accessibilityLabel="내가 원하는 것의 참고 사진"
      source={{ uri: source }}
      resizeMode="contain"
      style={{
        width: large ? "100%" : 66,
        height: large ? 210 : 66,
        backgroundColor: C.bg,
        borderRadius: 16,
      }}
    />
  );
}
export function WishListScreen() {
  const query = useDavaq<Page<Wish>>("/exchange/wishes"),
    router = useRouter();
  const [filter, setFilter] = useState("active");
  const items = (query.data?.items ?? []).filter(
    (w) => w.status !== "deleted" && (filter === "all" || w.status === filter),
  );
  return (
    <Frame
      back
      title="내 소원함"
      subtitle="갖고 싶은 것에서, 교환할 수 있는 것으로"
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
    >
      <Button
        label="새 소원 Q에게 보내기"
        icon="plus"
        onPress={() => router.push("/wishes/new" as never)}
      />
      <View style={S.wrap}>
        {[
          ["active", "찾는 소원"],
          ["paused", "잠시 쉬기"],
          ["fulfilled", "구했어요"],
          ["all", "전체"],
        ].map(([id, title]) => (
          <Chip
            key={id}
            label={title}
            active={filter === id}
            onPress={() => setFilter(id)}
          />
        ))}
      </View>
      <QueryState query={query} />
      {items.map((w) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={w.title + " 소원 열기"}
          key={w.id}
          style={S.card}
          onPress={() => router.push(("/wishes/" + w.id) as never)}
        >
          <View style={[S.row, { alignItems: "flex-start" }]}>
            <WishPhoto imageKey={w.imageKey} />
            <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
              <Txt size={12} color={C.purple}>
                {wishStatus(w.status)} · {categoryName(w.category)}
              </Txt>
              <Txt size={19} bold>
                {w.title}
              </Txt>
              <Txt color={C.muted} size={12} lines={2}>
                {w.keywords.join(" · ")}
              </Txt>
            </View>
            <Icon name="chevron-right" size={18} />
          </View>
        </Pressable>
      ))}
      {query.isSuccess && !items.length && (
        <Empty
          title={
            filter === "active"
              ? "갖고 싶은 것 하나부터"
              : "아직 이곳에는 소원이 없어요"
          }
          body={
            filter === "active"
              ? "쇼핑하다 발견한 사진이나 원하는 물건의 설명을 보내세요. Q와 교환 후보를 찾아볼 수 있어요."
              : "소원의 상태를 바꾸면 이곳에서 다시 확인할 수 있어요."
          }
          action="소원 추가하기"
          onPress={() => router.push("/wishes/new" as never)}
        />
      )}
      <Notice>
        소원과 참고 사진은 나만 볼 수 있어요. 상대방에게 교환을 제안하면 내가
        주고받을 물건과 제안 조건을 함께 확인해요.
      </Notice>
    </Frame>
  );
}
type Form = Pick<
  Wish,
  "title" | "description" | "kind" | "category" | "imageKey"
>;
const blankForm: Form = {
  title: "",
  description: "",
  kind: "goods",
  category: "goods",
  imageKey: null,
};
export function WishEditorScreen() {
  const params = useLocalSearchParams<{ id?: string; text?: string }>(),
    router = useRouter();
  const existing = useDavaq<Wish>(wishPath(params.id ?? ""), !!params.id),
    mutation = useDavaqMutation<Wish>();
  const [form, setForm] = useState<Form>(blankForm),
    [speech, setSpeech] = useState(params.text ?? ""),
    [keywords, setKeywords] = useState("");
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null),
    [review, setReview] = useState(!!params.id),
    [drafting, setDrafting] = useState(false),
    [uploading, setUploading] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [questions, setQuestions] = useState<string[]>([]);
  const loadedVersion = useRef<number | undefined>(undefined);
  const loaded = useRef(""),
    request = useRef(key()),
    busy = drafting || uploading || mutation.isPending;
  useEffect(() => {
    if (existing.data && loaded.current !== existing.data.id) {
      const w = existing.data;
      setForm({
        title: w.title,
        description: w.description,
        kind: w.kind,
        category: w.category,
        imageKey: w.imageKey,
      });
      setKeywords(w.keywords.join(", "));
      loaded.current = w.id;
      loadedVersion.current = w.version;
    }
  }, [existing.data]);
  const set = <K extends keyof Form>(field: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [field]: value }));
  async function choosePhoto() {
    setError("");
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted)
        throw new Error("사진 접근을 허용하거나 설명으로 소원을 적어주세요.");
      const selected = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
      });
      if (selected.canceled) return;
      const asset = selected.assets[0];
      if (asset.fileSize && asset.fileSize > 8 * 1024 * 1024)
        throw new Error("8MB 이하의 JPEG, PNG, WebP 사진을 선택해 주세요.");
      if (
        asset.mimeType &&
        !["image/jpeg", "image/png", "image/webp"].includes(asset.mimeType)
      )
        throw new Error("JPEG, PNG, WebP 사진을 선택해 주세요.");
      setPhoto(asset);
      setNotice("");
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function uploadPhoto(): Promise<string | null> {
    if (!photo) return form.imageKey;
    setUploading(true);
    try {
      const blob = await (await fetch(photo.uri)).blob(),
        type = photo.mimeType || blob.type;
      if (blob.size > 8 * 1024 * 1024)
        throw new Error("8MB 이하의 사진을 선택해 주세요.");
      if (!["image/jpeg", "image/png", "image/webp"].includes(type))
        throw new Error("JPEG, PNG, WebP 사진을 선택해 주세요.");
      const result = await customFetch<{ objectPath: string }>(
        "/api/exchange/uploads",
        { method: "POST", headers: { "Content-Type": type }, body: blob },
      );
      set("imageKey", result.objectPath);
      setPhoto(null);
      return result.objectPath;
    } finally {
      setUploading(false);
    }
  }
  async function draft() {
    if (busy) return;
    setError("");
    setNotice("");
    if (!speech.trim() && !photo && !form.imageKey) {
      setError("원하는 것의 사진이나 설명을 먼저 보내주세요.");
      return;
    }
    setDrafting(true);
    try {
      const imageKey = await uploadPhoto();
      const result = await api<WishDraft>("/exchange/wishes/draft", "POST", {
        text: speech.trim(),
        imageKey,
      });
      setForm({
        title: result.title,
        description: result.description,
        category: result.category,
        kind: result.kind,
        imageKey,
      });
      setKeywords(result.keywords.join(", "));
      setQuestions(result.questions);
      setReview(true);
      setNotice(
        "Q가 정리한 초안이에요. 원하는 제품과 검색어가 맞는지 확인해 주세요.",
      );
    } catch (e) {
      setReview(true);
      setError(errorText(e) + " 아래 내용을 직접 적어 저장할 수도 있어요.");
    } finally {
      setDrafting(false);
    }
  }
  async function save() {
    if (busy) return;
    setError("");
    const searchWords = [
      ...new Set(
        keywords
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (form.title.trim().length < 2) {
      setError("원하는 것의 이름을 2자 이상 적어주세요.");
      return;
    }
    if (
      !searchWords.length ||
      searchWords.length > 6 ||
      searchWords.some((k) => k.length < 2 || k.length > 40)
    ) {
      setError(
        "검색어를 2~40자로, 1~6개 적어주세요. 여러 개는 쉼표로 나눠주세요.",
      );
      return;
    }
    try {
      const imageKey = await uploadPhoto();
      const w = await mutation.mutateAsync({
        path: params.id ? wishPath(params.id) : "/exchange/wishes",
        method: params.id ? "PATCH" : "POST",
        body: {
          ...form,
          title: form.title.trim(),
          description: form.description.trim(),
          imageKey,
          keywords: searchWords,
          ...(params.id
            ? { version: loadedVersion.current }
            : { requestKey: request.current }),
        },
      });
      router.replace(("/wishes/" + w.id) as never);
    } catch (e) {
      setError(errorText(e));
    }
  }
  const mayEdit =
    !params.id || (existing.isSuccess && existing.data.status !== "deleted");
  return (
    <Frame
      back
      title={params.id ? "소원 다듬기" : "Q에게 보내기"}
      subtitle="결제하기 전에, 바꿀 수 있는지 먼저"
    >
      {!!params.id && <QueryState query={existing} />}
      {mayEdit && (
        <>
          <View style={[S.card, { backgroundColor: C.soft }]}>
            <View style={S.row}>
              <Cue size={62} />
              <View style={{ flex: 1, gap: 4 }}>
                <Txt bold size={19}>
                  무엇을 갖고 싶으세요?
                </Txt>
                <Txt color={C.muted} size={12}>
                  사진 한 장, 또는 짧은 설명이면 시작할 수 있어요.
                </Txt>
              </View>
            </View>
            <WishPhoto imageKey={form.imageKey} uri={photo?.uri} large />
            <Button
              secondary
              label={
                photo || form.imageKey
                  ? "참고 사진 바꾸기"
                  : "갖고 싶은 것 사진 선택"
              }
              icon="image"
              disabled={busy}
              onPress={() => void choosePhoto()}
            />
            {(photo || form.imageKey) && (
              <Button
                small
                secondary
                label="사진 빼기"
                disabled={busy}
                onPress={() => {
                  setPhoto(null);
                  set("imageKey", null);
                }}
              />
            )}
            <Field
              label="원하는 것과 중요한 조건"
              multiline
              placeholder="예: 무선 헤드폰을 갖고 싶어요. 이동할 때 쓸 거라 노이즈 캔슬링이 되면 좋아요."
              value={speech}
              onChangeText={setSpeech}
              maxLength={2000}
              editable={!busy}
            />
            <Txt size={11} color={C.muted}>
              상품이 잘 보이는 사진을 올려주세요. 주문·결제 정보나 다른 사람의
              얼굴은 가려주세요. 사진은 ‘Q로 정리하기’ 또는 ‘소원 저장’을 누를
              때 전송되고, AI 분석은 ‘Q로 정리하기’를 누를 때만 진행돼요.
            </Txt>
            <Button
              label={
                drafting ? "Q가 원하는 것을 살펴보고 있어요" : "Q로 정리하기"
              }
              icon="zap"
              busy={drafting}
              disabled={busy}
              onPress={() => void draft()}
            />
            {!review && (
              <Button
                secondary
                label="직접 적어서 시작하기"
                disabled={busy}
                onPress={() => {
                  setReview(true);
                  if (!form.title && speech.trim()) {
                    set("title", speech.trim().slice(0, 80));
                    setKeywords(speech.trim().slice(0, 40));
                  }
                }}
              />
            )}
          </View>
          {!!error && <Notice error>{error}</Notice>}
          {!!notice && <Notice>{notice}</Notice>}
          {review && (
            <View style={S.card}>
              <Txt bold size={20}>
                내가 찾는 것, 맞나요?
              </Txt>
              {questions.length > 0 && <Notice>{questions.join("\n")}</Notice>}
              <Field
                label="갖고 싶은 것"
                hint="상품명은 짧고 정확하게 적어주세요. 용도·색상·상태 등 희망 조건은 아래 설명에 적어주세요."
                value={form.title}
                onChangeText={(v) => set("title", v)}
                placeholder="예: 노이즈 캔슬링 무선 헤드폰"
                maxLength={80}
                editable={!busy}
              />
              <Field
                label="검색어 · 쉼표로 나눠주세요"
                value={keywords}
                onChangeText={setKeywords}
                placeholder="예: 헤드폰, 무선 헤드폰"
                hint="꼭 포함할 이름·모델·특징 1~6개. 입력한 검색어가 모두 포함된 등록을 찾아요."
                maxLength={250}
                editable={!busy}
              />
              <Txt bold size={13}>
                종류
              </Txt>
              <View style={S.wrap}>
                {[
                  ["goods", "물건"],
                  ["service", "재능"],
                  ["experience", "경험"],
                ].map(([value, label]) => (
                  <Chip
                    key={value}
                    label={label}
                    active={form.kind === value}
                    onPress={() => {
                      if (!busy) set("kind", value as Form["kind"]);
                    }}
                  />
                ))}
              </View>
              <Txt bold size={13}>
                분야
              </Txt>
              <View style={S.wrap}>
                {categories.map(([value, label]) => (
                  <Chip
                    key={value}
                    label={label}
                    active={form.category === value}
                    onPress={() => {
                      if (!busy) set("category", value);
                    }}
                  />
                ))}
              </View>
              <Field
                label="원하는 상태·조건"
                multiline
                value={form.description}
                onChangeText={(v) => set("description", v)}
                maxLength={1000}
                placeholder="원하는 모델, 상태, 색상이나 교환 지역을 적어주세요."
                editable={!busy}
              />
              <Notice>
                나만 보는 소원이에요. 저장하면 현재 등록된 물건·재능으로 교환
                후보를 찾아볼 수 있어요. 제안하기 전에는 상대방에게 메시지를
                보내지 않아요.
              </Notice>
              <Button
                label={params.id ? "소원 수정 저장" : "소원 저장하고 교환 찾기"}
                busy={uploading || mutation.isPending}
                disabled={busy}
                onPress={() => void save()}
              />
            </View>
          )}
        </>
      )}
    </Frame>
  );
}
function Outcome({ offer, target }: { offer: Listing; target: Listing }) {
  return (
    <View style={{ gap: 10 }}>
      <View
        style={[
          S.row,
          {
            alignItems: "flex-start",
            backgroundColor: C.bg,
            padding: 12,
            borderRadius: 14,
          },
        ]}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Txt color={C.muted} size={11}>
            내가 줄 것
          </Txt>
          <Txt bold>{offer.title}</Txt>
        </View>
        <Icon name="arrow-down" size={18} />
      </View>
      <View
        style={[
          S.row,
          {
            alignItems: "flex-start",
            backgroundColor: C.soft,
            padding: 12,
            borderRadius: 14,
          },
        ]}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Txt color={C.purple} size={11}>
            내가 받을 것
          </Txt>
          <Txt bold color={C.purple}>
            {target.title}
          </Txt>
        </View>
      </View>
    </View>
  );
}
function DirectCard({ match }: { match: Match }) {
  const router = useRouter();
  return (
    <View style={S.card}>
      <View style={S.wrap}>
        <Chip label="둘이 직접 바꾸기" />
        <Chip label="조건 확인 전" />
      </View>
      <Outcome offer={match.offer} target={match.target} />
      <Txt size={12} color={C.muted}>
        {match.reasons.join(" · ")}
      </Txt>
      <Txt size={12} color={C.muted}>
        {match.pending[0] || "물건 상태와 일정은 상대방과 함께 확인해요."}
      </Txt>
      <Button
        label="이 교환 알아보기"
        onPress={() =>
          router.push(
            ("/exchange/propose?target=" +
              encodeURIComponent(match.target.id) +
              "&offer=" +
              encodeURIComponent(match.offer.id)) as never,
          )
        }
      />
    </View>
  );
}
function WishRelayCard({
  candidate,
  wishId,
}: {
  candidate: RelayCandidate;
  wishId: string;
}) {
  const me = useGetMe(),
    router = useRouter(),
    path = rotateForViewer(candidate.listings, me.data?.id);
  if (!path.length) return null;
  return (
    <View style={S.card}>
      <View style={S.wrap}>
        <Chip label={path.length + "명이 이어 바꾸기"} />
        <Chip label="조건 확인 전" />
      </View>
      <Outcome offer={path[0]} target={path[path.length - 1]} />
      <Txt size={12} color={C.muted}>
        중간 물건을 직접 받아 되팔 필요 없이, 각자 필요한 사람에게 전달해요.
      </Txt>
      <Txt size={12} color={C.muted}>
        {candidate.pending[0] ||
          "참여자 모두가 같은 조건에 동의해야 교환이 확정돼요."}
      </Txt>
      <Button
        label="어떻게 이어지는지 보기"
        onPress={() =>
          router.push(
            ("/relay/new?ids=" +
              encodeURIComponent(
                candidate.listings.map((l) => l.id).join(","),
              ) +
              "&wishId=" +
              encodeURIComponent(wishId)) as never,
          )
        }
      />
    </View>
  );
}
export function WishDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    router = useRouter();
  const query = useDavaq<Wish>(wishPath(id ?? ""), !!id),
    wish = query.data;
  const agent = useDavaq<Agent>("/agents/me");
  const candidates = useDavaq<WishCandidates>(
    wishPath(id ?? "") + "/candidates",
    !!id && wish?.status === "active",
  );
  const mutation = useDavaqMutation<Wish>(),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const result = candidates.data,
    count = (result?.direct.length ?? 0) + (result?.relays.length ?? 0);
  const refresh = () => {
    void query.refetch();
    if (wish?.status === "active") void candidates.refetch();
  };
  async function setStatus(status: Wish["status"]) {
    if (!wish || mutation.isPending) return;
    setError("");
    try {
      await mutation.mutateAsync({
        path: wishPath(wish.id),
        method: "PATCH",
        body: { version: wish.version, status },
      });
      setDeleting(false);
      if (status === "deleted") router.replace("/wishes" as never);
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Frame
      back
      title="내 소원"
      subtitle="내가 원하는 것까지, Q와 한 걸음"
      onRefresh={refresh}
      refreshing={query.isRefetching || candidates.isRefetching}
    >
      <QueryState query={query} />
      {!!error && <Notice error>{error}</Notice>}
      {wish && (
        <>
          <View style={S.card}>
            <View style={S.wrap}>
              <Chip label={wishStatus(wish.status)} />
              <Chip label="나만 보는 소원" />
            </View>
            <WishPhoto imageKey={wish.imageKey} large />
            <Txt size={25} bold>
              {wish.title}
            </Txt>
            {!!wish.description && (
              <Txt color={C.muted} size={14}>
                {wish.description}
              </Txt>
            )}
            <View style={S.wrap}>
              {wish.keywords.map((k) => (
                <Chip key={k} label={k} />
              ))}
            </View>
            <Button
              small
              secondary
              icon="edit-2"
              label="조건 다듬기"
              disabled={mutation.isPending}
              onPress={() =>
                router.push(("/wishes/new?id=" + wish.id) as never)
              }
            />
          </View>
          {wish.status === "active" ? (
            <>
              <View style={S.card}>
                <View style={S.row}>
                  <Cue size={54} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Txt bold size={18}>
                      {candidates.isFetching
                        ? "교환할 방법을 살펴보고 있어요"
                        : count
                          ? "이렇게 바꿔볼 수 있어요"
                          : "원하는 것까지 연결을 찾아봐요"}
                    </Txt>
                    <Txt color={C.muted} size={12}>
                      직접 교환부터 3~4명이 이어 바꾸는 경로까지
                    </Txt>
                  </View>
                </View>
                <Button
                  label="최신 교환 다시 찾기"
                  icon="refresh-cw"
                  secondary
                  busy={candidates.isFetching}
                  onPress={() => void candidates.refetch()}
                />
                {agent.data && (
                  <View style={{ gap: 8 }}>
                    <Txt color={C.muted} size={12}>
                      {agent.data.settings.auto_search
                        ? "Q가 새 연결도 찾아봐요. 새 후보가 생기면 Q 대화에서 알려드려요."
                        : "자동으로도 찾으려면 내 AI에서 자동 매칭을 켜세요."}
                    </Txt>
                    <Button
                      small
                      secondary
                      label="자동 매칭 설정"
                      onPress={() => router.push("/agent/settings" as never)}
                    />
                  </View>
                )}
                {result?.searchedAt && (
                  <Txt color={C.muted} size={11}>
                    {new Date(result.searchedAt).toLocaleString("ko-KR", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    검색 결과 · 현재 등록된 교환 기준
                  </Txt>
                )}
              </View>
              <QueryState query={candidates} />
              {candidates.isSuccess && result && (
                <>
                  {result.offersCount === 0 && (
                    <Empty
                      title="이번엔 내가 줄 수 있는 것 하나"
                      body="안 쓰는 물건뿐 아니라 촬영, 디자인, 레슨 같은 재능도 좋아요. 공개한 제공 항목이 있어야 나에게 이어지는 교환을 찾을 수 있어요."
                      action="내 물건·재능 등록하기"
                      onPress={() =>
                        router.push(
                          ("/exchange/new?mode=offer&text=" +
                            encodeURIComponent(
                              "받고 싶은 것은 " +
                                wish.title +
                                "입니다. 내가 줄 수 있는 것은 ",
                            )) as never,
                        )
                      }
                    />
                  )}
                  {count > 0 ? (
                    <>
                      <Section title={count + "개의 교환 후보"} />
                      <Notice>
                        아직 제안하거나 동의를 받지 않은 후보예요. 실제
                        제품·모델·상태를 확인하고, 참여자가 모두 동의하면 교환이
                        확정돼요.
                      </Notice>
                      {result.direct.map((m) => (
                        <DirectCard key={m.id} match={m} />
                      ))}
                      {result.relays.map((c) => (
                        <WishRelayCard
                          key={c.id}
                          candidate={c}
                          wishId={wish.id}
                        />
                      ))}
                    </>
                  ) : result.offersCount > 0 ? (
                    <View style={S.card}>
                      <Txt bold size={20}>
                        아직 이어지는 교환이 없어요
                      </Txt>
                      <Txt color={C.muted} size={13}>
                        {result.targetCount
                          ? "원하는 것과 비슷한 등록은 있지만, 서로 받을 조건이 이어지는 경로는 아직 없어요."
                          : "지금 검색어와 종류에 맞는 공개 등록이 없어요."}{" "}
                        검색어를 다듬거나 내가 줄 수 있는 것을 더 등록해 보세요.
                      </Txt>
                      <Button
                        secondary
                        label="검색어와 조건 다듬기"
                        onPress={() =>
                          router.push(("/wishes/new?id=" + wish.id) as never)
                        }
                      />
                      <Button
                        secondary
                        label="줄 수 있는 것 더 등록"
                        onPress={() =>
                          router.push("/exchange/new?mode=offer" as never)
                        }
                      />
                    </View>
                  ) : null}
                  {!count && result.targets.length > 0 && (
                    <>
                      <Section title="원하는 것과 비슷한 등록" />
                      <Txt color={C.muted} size={12}>
                        교환 경로가 완성된 후보는 아니에요. 세부 조건과 상대방이
                        원하는 것을 먼저 살펴보세요.
                      </Txt>
                      {result.targets.slice(0, 6).map((l) => (
                        <Pressable
                          accessibilityRole="button"
                          key={l.id}
                          onPress={() =>
                            router.push(("/exchange/listings/" + l.id) as never)
                          }
                          style={S.card}
                        >
                          <Txt bold>{l.title}</Txt>
                          <Txt size={12} color={C.muted}>
                            {l.wantedText || "상대방이 원하는 조건 확인하기"}
                          </Txt>
                          <Txt color={C.purple} size={12} bold>
                            등록 자세히 보기 →
                          </Txt>
                        </Pressable>
                      ))}
                    </>
                  )}
                  {result.limited && (
                    <Notice>
                      이번에는 일부 공개 등록에서 후보를 찾았어요. 검색어와
                      조건을 구체적으로 적으면 후보를 살펴보기 쉬워요.
                    </Notice>
                  )}
                </>
              )}
            </>
          ) : (
            <View style={[S.card, { backgroundColor: C.soft }]}>
              <Txt bold size={21}>
                {wish.status === "fulfilled"
                  ? "원하던 것을 구했군요"
                  : "이 소원은 잠시 쉬고 있어요"}
              </Txt>
              <Txt color={C.muted} size={13}>
                원할 때 다시 교환 후보를 찾아볼 수 있어요.
              </Txt>
              <Button
                label="다시 교환 찾기"
                busy={mutation.isPending}
                onPress={() => void setStatus("active")}
              />
            </View>
          )}
          <View style={S.card}>
            <Txt bold>소원 관리</Txt>
            {wish.status === "active" && (
              <Button
                secondary
                label="이 소원 잠시 쉬기"
                disabled={mutation.isPending}
                onPress={() => void setStatus("paused")}
              />
            )}
            {wish.status !== "fulfilled" && (
              <Button
                secondary
                label="이미 구했어요"
                disabled={mutation.isPending}
                onPress={() => void setStatus("fulfilled")}
              />
            )}
            <Txt size={11} color={C.muted}>
              소원 상태를 바꿔도 이미 보낸 교환 제안은 유지돼요. 제안
              변경·취소는 해당 교환에서 진행해 주세요.
            </Txt>
            {deleting ? (
              <>
                <Notice>
                  이 소원을 삭제할까요? 소원함에서 사라지고 다시 검색하지
                  않아요.
                </Notice>
                <Button
                  label="소원 삭제하기"
                  busy={mutation.isPending}
                  onPress={() => void setStatus("deleted")}
                />
                <Button
                  secondary
                  label="소원 남겨두기"
                  disabled={mutation.isPending}
                  onPress={() => setDeleting(false)}
                />
              </>
            ) : (
              <Button
                small
                secondary
                label="소원 삭제"
                disabled={mutation.isPending}
                onPress={() => setDeleting(true)}
              />
            )}
          </View>
        </>
      )}
    </Frame>
  );
}
