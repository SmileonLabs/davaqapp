import React, { useEffect, useRef, useState } from "react";
import { View, Pressable, Image } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { useMediaUri } from "@/hooks/useMediaUri";
import {
  useDavaq,
  useDavaqMutation,
  api,
  key,
  errorText,
  categories,
  categoryName,
  kindName,
  statusName,
  listingBody,
  type Listing,
  type Page,
  type Match,
} from "@/lib/davaq";
import {
  C,
  S,
  Txt,
  Frame,
  Button,
  Chip,
  Field,
  Section,
  Cue,
  Empty,
  QueryState,
  Notice,
  ListingImage,
} from "./UI";

const emptyListing: Listing = {
  id: "",
  ownerId: "",
  ownerName: "",
  mode: "offer",
  kind: "service",
  category: "voice",
  title: "",
  description: "",
  wantedText: "",
  wantedCategories: [],
  location: "",
  delivery: "online",
  durationMinutes: 30,
  availableDays: [],
  ev: null,
  imageKey: null,
  status: "draft",
  terms: "",
  version: 1,
  favorite: false,
};
const templates: Record<string, Partial<Listing>> = {
  voice: {
    title: "CEO Voice & Presence",
    kind: "experience",
    category: "voice",
    durationMinutes: 90,
    ev: 100,
    description:
      "호흡·발성 30분, 목소리 전달력 30분, 발표 실습 30분.\n나의 실제 경험과 제공할 수 있는 범위로 수정해 주세요.",
  },
  mentoring: {
    title: "Business Mentoring",
    kind: "experience",
    category: "business",
    durationMinutes: 120,
    ev: 300,
    description:
      "사업 경험을 바탕으로 함께 고민하는 1:1 멘토링.\n전문 분야와 진행 범위를 직접 적어 주세요.",
  },
  dinner: {
    title: "Executive Dinner & Mentoring",
    kind: "experience",
    category: "business",
    delivery: "offline",
    durationMinutes: 180,
    ev: 500,
    description:
      "식사와 함께 나누는 사업 경험.\n식사 포함 범위, 장소, 본인의 경험을 직접 적어 주세요.",
  },
};
export function ListingEditor() {
  const router = useRouter(),
    params = useLocalSearchParams<{
      id?: string;
      mode?: string;
      template?: string;
      text?: string;
    }>(),
    existing = useDavaq<Listing>(
      "/exchange/listings/" + params.id,
      !!params.id,
    ),
    mutation = useDavaqMutation<Listing>(),
    [form, setForm] = useState<Listing>(() => ({
      ...emptyListing,
      mode: params.mode === "want" ? "want" : "offer",
      ...(templates[params.template ?? ""] ?? {}),
    })),
    [speech, setSpeech] = useState(params.text ?? ""),
    [questions, setQuestions] = useState<string[]>([]),
    [drafting, setDrafting] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const requestKey = useRef(key()),
    uri = useMediaUri(form.imageKey),
    loaded = useRef("");
  useEffect(() => {
    if (existing.data && loaded.current !== existing.data.id) {
      setForm(existing.data);
      loaded.current = existing.data.id;
    }
  }, [existing.data]);
  const set = <K extends keyof Listing>(field: K, value: Listing[K]) =>
    setForm((f) => ({ ...f, [field]: value }));
  async function draft() {
    setError("");
    setDrafting(true);
    try {
      const result = await api<Partial<Listing> & { questions: string[] }>(
        "/agents/me/registration-draft",
        "POST",
        { text: speech },
      );
      const { questions, ...fields } = result;
      setForm((f) => ({ ...f, ...fields }));
      setQuestions(questions);
      setNotice(
        "큐가 초안을 정리했어요. 아래 내용을 확인하고 직접 공개해 주세요.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setDrafting(false);
    }
  }
  async function upload() {
    setError("");
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError("사진을 선택하려면 사진 접근을 허용해 주세요.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
      });
      if (result.canceled) return;
      setUploading(true);
      const asset = result.assets[0],
        blob = await (await fetch(asset.uri)).blob();
      if (blob.size > 8 * 1024 * 1024)
        throw new Error("8MB 이하의 사진을 선택해 주세요.");
      const type = asset.mimeType || blob.type;
      if (!["image/jpeg", "image/png", "image/webp"].includes(type))
        throw new Error("JPEG, PNG, WebP 사진을 선택해 주세요.");
      const resultUpload = await customFetch<{ objectPath: string }>(
        "/api/exchange/uploads",
        { method: "POST", headers: { "Content-Type": type }, body: blob },
      );
      set("imageKey", resultUpload.objectPath);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(false);
    }
  }
  async function save(status: string) {
    setError("");
    setNotice("");
    if (form.title.trim().length < 2) {
      setError("제목을 2자 이상 적어주세요.");
      return;
    }
    if (status === "published" && !form.wantedCategories.length) {
      setError(
        "AI가 교환을 찾을 수 있도록 받고 싶은 분야를 하나 이상 골라주세요.",
      );
      return;
    }
    try {
      const result = await mutation.mutateAsync({
        path: params.id
          ? "/exchange/listings/" + params.id
          : "/exchange/listings",
        method: params.id ? "PATCH" : "POST",
        body: {
          ...listingBody(form, status),
          ...(!params.id ? { requestKey: requestKey.current } : {}),
        },
      });
      router.replace(("/exchange/listings/" + result.id) as never);
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Frame
      back
      title={params.id ? "교환 수정" : "교환 등록"}
      subtitle="내가 가진 가능성을 새로운 경험으로"
    >
      {params.id && <QueryState query={existing} />}
      <View style={[S.card, { backgroundColor: C.soft }]}>
        <View style={S.row}>
          <Cue size={58} />
          <Txt bold size={17}>
            편하게 말하면, 큐가 정리해요
          </Txt>
        </View>
        <Field
          label="줄 수 있는 것과 받고 싶은 것"
          multiline
          placeholder="영어 회화 30분 도와드릴 수 있어요. 대신 프로필 사진을 찍어줄 분을 찾아요."
          value={speech}
          onChangeText={setSpeech}
        />
        <Button
          label="AI로 초안 정리"
          busy={drafting}
          disabled={
            speech.trim().length < 5 || (!!params.id && existing.isPending)
          }
          onPress={() => void draft()}
        />
      </View>
      {questions.map((q) => (
        <Notice key={q}>{q}</Notice>
      ))}
      {notice && <Notice>{notice}</Notice>}
      <Section title="교환 내용을 확인해 주세요" />
      <View style={S.wrap}>
        <Chip
          label="줄 수 있어요"
          active={form.mode === "offer"}
          onPress={() => set("mode", "offer")}
        />
        <Chip
          label="받고 싶어요"
          active={form.mode === "want"}
          onPress={() => set("mode", "want")}
        />
      </View>
      <View style={S.wrap}>
        {(["goods", "service", "experience"] as const).map((v) => (
          <Chip
            key={v}
            label={kindName(v)}
            active={form.kind === v}
            onPress={() => set("kind", v)}
          />
        ))}
      </View>
      {form.kind === "experience" && !params.id && (
        <View style={{ gap: 8 }}>
          <Txt size={13} color={C.muted}>
            내 경험으로 수정해서 쓰는 템플릿
          </Txt>
          <View style={S.wrap}>
            {Object.entries(templates).map(([id, t]) => (
              <Chip
                key={id}
                label={t.title!}
                onPress={() => {
                  setForm((f) => ({ ...f, ...t }));
                  setNotice(
                    "경력과 제공 범위를 본인의 실제 내용으로 수정해 주세요.",
                  );
                }}
              />
            ))}
          </View>
        </View>
      )}
      <Field
        label="제목"
        placeholder="무엇을 제공하거나 받고 싶나요?"
        value={form.title}
        maxLength={80}
        onChangeText={(v) => set("title", v)}
      />
      <Txt bold size={14}>
        분야
      </Txt>
      <View style={S.wrap}>
        {categories.map(([id, label]) => (
          <Chip
            key={id}
            label={label}
            active={form.category === id}
            onPress={() => set("category", id)}
          />
        ))}
      </View>
      <Field
        label="경험과 제공 범위"
        multiline
        placeholder="어떤 경험이 있나요? 무엇을 어디까지 제공하나요?"
        value={form.description}
        maxLength={3000}
        onChangeText={(v) => set("description", v)}
      />
      {uri && (
        <Image
          source={{ uri }}
          style={{ height: 200, borderRadius: 16 }}
          resizeMode="cover"
        />
      )}
      <View style={S.row}>
        <Button
          secondary
          label="사진 선택"
          busy={uploading}
          onPress={() => void upload()}
        />
        {form.imageKey && (
          <Button
            secondary
            label="사진 빼기"
            onPress={() => set("imageKey", null)}
          />
        )}
      </View>
      <Field
        label={
          form.mode === "offer" ? "대신 받고 싶은 것" : "대신 줄 수 있는 것"
        }
        multiline
        placeholder="서로 교환할 내용을 알려주세요."
        value={form.wantedText}
        maxLength={500}
        onChangeText={(v) => set("wantedText", v)}
      />
      <Txt bold size={14}>
        교환 희망 분야 · 여러 개 선택
      </Txt>
      <View style={S.wrap}>
        {categories.map(([id, label]) => (
          <Chip
            key={id}
            label={label}
            active={form.wantedCategories.includes(id)}
            onPress={() =>
              set(
                "wantedCategories",
                form.wantedCategories.includes(id)
                  ? form.wantedCategories.filter((c) => c !== id)
                  : [...form.wantedCategories, id],
              )
            }
          />
        ))}
      </View>
      <View style={S.wrap}>
        {(
          [
            ["online", "온라인"],
            ["offline", "직접 만나기"],
            ["either", "둘 다 가능"],
          ] as const
        ).map(([id, label]) => (
          <Chip
            key={id}
            label={label}
            active={form.delivery === id}
            onPress={() => set("delivery", id)}
          />
        ))}
      </View>
      {form.delivery !== "online" && (
        <Field
          label="활동 지역"
          placeholder="예: 서울 강남구"
          value={form.location}
          onChangeText={(v) => set("location", v)}
        />
      )}
      <View style={S.row}>
        <View style={{ flex: 1 }}>
          <Field
            label="진행 시간 (분)"
            keyboardType="number-pad"
            value={String(form.durationMinutes || "")}
            onChangeText={(v) =>
              set("durationMinutes", Number(v.replace(/[^0-9]/g, "")))
            }
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="희망 EV · 선택"
            keyboardType="number-pad"
            value={form.ev == null ? "" : String(form.ev)}
            onChangeText={(v) =>
              set("ev", v ? Number(v.replace(/[^0-9]/g, "")) : null)
            }
          />
        </View>
      </View>
      <Txt color={C.muted} size={12}>
        EV는 서로의 희망 교환가치를 비교하는 참고값이에요. 결제·충전·현금 전환
        기능은 없어요.
      </Txt>
      <Txt bold size={14}>
        가능한 요일 · 선택
      </Txt>
      <View style={S.wrap}>
        {"일월화수목금토".split("").map((d, i) => (
          <Chip
            key={d}
            label={d}
            active={form.availableDays.includes(i)}
            onPress={() =>
              set(
                "availableDays",
                form.availableDays.includes(i)
                  ? form.availableDays.filter((v) => v !== i)
                  : [...form.availableDays, i],
              )
            }
          />
        ))}
      </View>
      <Field
        label="준비물과 참여 조건"
        multiline
        placeholder="인원, 준비물, 포함·제외되는 것, 일정 변경 조건"
        value={form.terms}
        onChangeText={(v) => set("terms", v)}
        maxLength={1500}
      />
      {form.category === "other" && (
        <Notice>기타 분야는 공개 전에 운영 검토가 필요해요.</Notice>
      )}
      {error && <Notice error>{error}</Notice>}
      <View style={S.row}>
        <Button
          secondary
          style={{ flex: 1 }}
          label="임시 저장"
          busy={mutation.isPending}
          disabled={uploading || drafting}
          onPress={() => void save("draft")}
        />
        <Button
          style={{ flex: 1 }}
          label="확인하고 공개"
          busy={mutation.isPending}
          disabled={uploading || drafting}
          onPress={() => void save("published")}
        />
      </View>
    </Frame>
  );
}
export function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    router = useRouter(),
    me = useGetMe(),
    query = useDavaq<Listing>("/exchange/listings/" + id),
    mutation = useDavaqMutation(),
    [error, setError] = useState(""),
    l = query.data;
  async function change(status: string) {
    if (!l) return;
    try {
      await mutation.mutateAsync({
        path: "/exchange/listings/" + id,
        method: "PATCH",
        body: listingBody(l, status),
      });
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Frame back title={l?.kind === "experience" ? "Experience" : "교환 상세"}>
      <QueryState query={query} />
      {l && (
        <>
          <View style={{ borderRadius: 24, overflow: "hidden" }}>
            <ListingImage listing={l} height={245} />
          </View>
          <View style={S.between}>
            <Txt color={C.purple} bold size={13}>
              {kindName(l.kind)} · {categoryName(l.category)}
            </Txt>
            <Chip
              label={l.favorite ? "♥ 저장됨" : "♡ 저장"}
              active={l.favorite}
              onPress={() => {
                void mutation
                  .mutateAsync({
                    path: "/exchange/listings/" + id + "/favorite",
                    body: { favorite: !l.favorite },
                  })
                  .catch((e) => setError(errorText(e)));
              }}
            />
          </View>
          <Txt size={27} bold>
            {l.title}
          </Txt>
          <Txt color={C.muted}>
            {l.ownerName || "제공자"} · {l.durationMinutes}분 ·{" "}
            {l.delivery === "online" ? "온라인" : l.location || "장소 협의"}
          </Txt>
          {l.ev && (
            <Txt bold color={C.purple} size={20}>
              희망 EV {l.ev}
            </Txt>
          )}
          <Txt>{l.description || "제공 범위는 대화로 확인해 주세요."}</Txt>
          <View style={S.card}>
            <Txt bold>
              {l.mode === "offer"
                ? "이런 교환을 원해요"
                : "대신 이런 것을 드릴 수 있어요"}
            </Txt>
            <Txt>{l.wantedText || "대화로 협의해요"}</Txt>
            <View style={S.wrap}>
              {l.wantedCategories.map((c) => (
                <Chip key={c} label={categoryName(c)} />
              ))}
            </View>
          </View>
          <View style={S.card}>
            <Txt bold>참여 조건</Txt>
            <Txt>
              {l.terms || "세부 조건은 제안 전에 상대방과 확인해 주세요."}
            </Txt>
            <Txt size={13} color={C.muted}>
              가능한 요일:{" "}
              {l.availableDays.length
                ? l.availableDays.map((d) => "일월화수목금토"[d]).join(" · ")
                : "협의"}
            </Txt>
          </View>
          <Txt color={C.muted} size={12}>
            희망 EV와 소개 내용은 등록자가 작성했어요. 실제 제공 범위와 일정은
            서로 확인한 후 확정해 주세요.
          </Txt>
          {me.data?.id === l.ownerId ? (
            <>
              {l.reviewNote && <Notice>운영 검토: {l.reviewNote}</Notice>}
              <Notice>
                {statusName(l.status)}
                {l.status === "pending"
                  ? " · 검토가 끝나면 공개할 수 있어요."
                  : ""}
              </Notice>
              <Button
                label="내용 수정"
                onPress={() => router.push(("/exchange/new?id=" + id) as never)}
              />
              <View style={S.row}>
                {l.status === "published" ? (
                  <Button
                    secondary
                    label="잠시 숨기기"
                    busy={mutation.isPending}
                    onPress={() => void change("paused")}
                  />
                ) : (
                  l.status !== "pending" && (
                    <Button
                      secondary
                      label="다시 공개"
                      busy={mutation.isPending}
                      onPress={() => void change("published")}
                    />
                  )
                )}
                <Button
                  secondary
                  label="마감하기"
                  busy={mutation.isPending}
                  disabled={l.status === "closed"}
                  onPress={() => void change("closed")}
                />
              </View>
            </>
          ) : l.mode === "offer" ? (
            <Button
              label="내 경험으로 교환 제안"
              icon="repeat"
              disabled={l.status !== "published"}
              onPress={() =>
                router.push(("/exchange/propose?target=" + id) as never)
              }
            />
          ) : (
            <>
              <Notice>
                이 희망에 맞는 제공 항목을 등록하면 상대가 찾아볼 수 있어요.
              </Notice>
              <Button
                label="내가 줄 수 있는 것 등록"
                onPress={() => router.push("/exchange/new?mode=offer")}
              />
            </>
          )}
          {error && <Notice error>{error}</Notice>}
        </>
      )}
    </Frame>
  );
}
export function MatchDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    query = useDavaq<Page<Match>>("/exchange/matches"),
    router = useRouter(),
    mutation = useDavaqMutation(),
    [error, setError] = useState(""),
    m = query.data?.items.find((m) => m.id === id);
  return (
    <Frame back title="큐가 찾은 연결">
      <QueryState query={query} />
      {m ? (
        <>
          <View style={{ alignItems: "center" }}>
            <Cue size={130} />
            <Txt bold size={23}>
              서로의 경험이 만나는 순간
            </Txt>
          </View>
          <View style={S.card}>
            <Txt color={C.muted} size={12}>
              내가 줄 수 있는 것
            </Txt>
            <Txt bold size={19}>
              {m.offer.title}
            </Txt>
            <Txt color={C.purple} size={24}>
              ⇅
            </Txt>
            <Txt color={C.muted} size={12}>
              내가 받을 수 있는 것
            </Txt>
            <Txt bold size={19}>
              {m.target.title}
            </Txt>
          </View>
          <Section title="추천한 이유" />
          {m.reasons.map((r) => (
            <Notice key={r}>✓ {r}</Notice>
          ))}
          <Section title="함께 확인할 조건" />
          {m.pending.map((r) => (
            <Txt key={r} color={C.muted}>
              · {r}
            </Txt>
          ))}
          <Button
            label="상대의 경험 자세히 보기"
            secondary
            onPress={() =>
              router.push(("/exchange/listings/" + m.target.id) as never)
            }
          />
          <Button
            label="교환 제안 작성"
            onPress={() =>
              router.push(
                ("/exchange/propose?target=" +
                  m.target.id +
                  "&offer=" +
                  m.offer.id) as never,
              )
            }
          />
          <Section title="이 추천은 어땠나요?" />
          <View style={S.wrap}>
            {[
              ["not_interested", "관심이 없어요"],
              ["schedule", "일정이 안 맞아요"],
              ["location", "지역이 달라요"],
              ["scope", "범위가 달라요"],
            ].map(([reason, label]) => (
              <Chip
                key={reason}
                label={label}
                onPress={() => {
                  void mutation
                    .mutateAsync({
                      path: "/exchange/matches/" + id + "/feedback",
                      body: { reason },
                    })
                    .then(() => router.back())
                    .catch((e) => setError(errorText(e)));
                }}
              />
            ))}
          </View>
        </>
      ) : (
        query.isSuccess && (
          <Empty
            title="추천 조건이 변경됐어요"
            body="등록 상태나 희망 조건이 달라졌을 수 있어요. 최신 후보를 다시 찾아볼게요."
            action="탐색 보기"
            onPress={() => router.replace("/agent/searches")}
          />
        )
      )}{" "}
      {error && <Notice error>{error}</Notice>}
    </Frame>
  );
}
