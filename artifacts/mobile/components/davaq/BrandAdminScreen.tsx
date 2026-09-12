import React, { useState, useRef } from "react";
import { View, Switch } from "react-native";
import { api, key, errorText, useDavaq, useDavaqMutation } from "@/lib/davaq";
import { rewardCategories, rewardTypes } from "@/lib/brandExchange";
import {
  C,
  S,
  Frame,
  Txt,
  Button,
  Field,
  Chip,
  Section,
  Notice,
  QueryState,
} from "./UI";
import BrandCreativeEditor, { type Difference } from "./BrandCreativeEditor";
type Campaign = {
  id: string;
  status: string;
  title: string;
  brand: string;
  budget: number;
  held: number;
  spent: number;
  available: number;
  starts: number;
  completed_playbacks: number;
  retries: number;
  successes: number;
  issued: number;
  self_reported_used: number;
};
type AdminData = {
  canManage: boolean;
  campaigns: Campaign[];
  issues: {
    id: string;
    status: string;
    title: string;
    issue: string;
    resolution: string;
  }[];
};
const blank = {
  title: "",
  brand: "",
  description: "",
  category: "food",
  rewardType: "coupon",
  rewardTitle: "",
  terms: "",
  extraCost: "없음",
  support: "",
  region: "",
  online: true,
  endsAt: "",
  duration: 30,
  cost: 0,
  videoA: "",
  videoB: "",
};
export default function BrandAdminScreen() {
  const q = useDavaq<AdminData>("/brand-admin"),
    m = useDavaqMutation(),
    [create, setCreate] = useState(false),
    [config, setConfig] = useState(blank),
    [answers, setAnswers] = useState<Difference[]>([]),
    [funded, setFunded] = useState(false),
    [rights, setRights] = useState(false),
    [budget, setBudget] = useState("0"),
    [selected, setSelected] = useState(""),
    [codes, setCodes] = useState(""),
    [validUntil, setValidUntil] = useState(""),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [issueReason, setIssueReason] = useState(""),
    requestKey = useRef(key());
  function value(k: keyof typeof blank, v: string | boolean | number) {
    setConfig((old) => ({ ...old, [k]: v }));
  }
  async function mutate(path: string, body: unknown) {
    setMessage("");
    try {
      const result = await m.mutateAsync({ path, body });
      setMessage("처리했어요.");
      return result;
    } catch (e) {
      setMessage(errorText(e));
      return null;
    }
  }
  async function save() {
    let endDate: string;
    try {
      endDate = new Date(config.endsAt).toISOString();
    } catch {
      setMessage("참여 종료일을 올바르게 입력해 주세요.");
      return;
    }
    const result = (await mutate("/brand-admin/campaigns", {
      config: {
        ...config,
        endsAt: endDate,
        rightsConfirmed: rights,
        fundingConfirmed: funded,
      },
      answers,
      budget: Number(budget),
      requestKey: requestKey.current,
    })) as { id: string } | null;
    if (result) {
      setSelected(result.id);
      setCreate(false);
      setConfig(blank);
      setAnswers([]);
      setFunded(false);
      setRights(false);
      requestKey.current = key();
    }
  }
  async function inventory() {
    let date: string;
    try {
      date = new Date(validUntil).toISOString();
    } catch {
      setMessage("쿠폰 유효기간을 입력해 주세요.");
      return;
    }
    const result = (await mutate(
      "/brand-admin/campaigns/" + selected + "/inventory",
      {
        codes: codes
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        validUntil: date,
      },
    )) as { added: number } | null;
    if (result) {
      setCodes("");
      setMessage(
        result.added + "개의 고유 코드를 등록했어요. 중복 코드는 제외했어요.",
      );
    }
  }
  const active = q.data?.campaigns.find((c) => c.id === selected);
  return (
    <Frame back title="브랜드 교환 운영" onRefresh={() => void q.refetch()}>
      <QueryState query={q} />
      <Notice>
        실제 광고주의 사용 허가와 확보한 보상만 등록해 주세요. 캠페인은 초안으로
        저장되며, 쿠폰 재고 등록과 최종 공개를 마쳐야 사용자에게 보여요.
      </Notice>
      {q.data?.canManage && (
        <Button
          label={create ? "작성 닫기" : "새 브랜드 교환 등록"}
          onPress={() => setCreate(!create)}
        />
      )}
      {create && q.data?.canManage && (
        <View style={{ gap: 15 }}>
          {(
            [
              ["brand", "광고주·브랜드명"],
              ["title", "교환 제목"],
              ["description", "브랜드 소개·참여 안내"],
              ["rewardTitle", "제공하는 혜택"],
              ["terms", "사용 조건·최소 구매·제한·발급 주체"],
              ["extraCost", "추가 결제·배송 비용"],
              ["support", "브랜드 문의처"],
              ["region", "사용 가능 지역"],
              ["endsAt", "참여 종료일 · YYYY-MM-DDTHH:mm:ss+09:00"],
            ] as const
          ).map(([k, l]) => (
            <Field
              key={k}
              label={l}
              value={String(config[k])}
              onChangeText={(v) => value(k, v)}
              multiline={k === "description" || k === "terms"}
            />
          ))}
          <View style={S.wrap}>
            {rewardCategories.map(([v, l]) => (
              <Chip
                key={v}
                label={l}
                active={config.category === v}
                onPress={() => value("category", v)}
              />
            ))}
          </View>
          <View style={S.wrap}>
            {Object.entries(rewardTypes).map(([v, l]) => (
              <Chip
                key={v}
                label={l}
                active={config.rewardType === v}
                onPress={() => value("rewardType", v)}
              />
            ))}
          </View>
          <View style={S.between}>
            <Txt>온라인 사용 가능</Txt>
            <Switch
              value={config.online}
              onValueChange={(v) => value("online", v)}
            />
          </View>
          <Field
            label="캠페인 확보 예산 (원)"
            value={budget}
            onChangeText={setBudget}
            keyboardType="number-pad"
          />
          <Field
            label="성공 1건의 보상 원가 (원)"
            value={String(config.cost)}
            onChangeText={(v) => value("cost", Number(v) || 0)}
            keyboardType="number-pad"
          />
          <BrandCreativeEditor
            onChange={(videoA, videoB, items) => {
              setConfig((old) => ({ ...old, videoA, videoB }));
              setAnswers(items);
            }}
          />
          <View style={S.between}>
            <Txt style={{ flex: 1 }}>
              두 영상의 사용·수정 허가와 정답, 가격·효능·주의사항의 정확성을
              확인했어요.
            </Txt>
            <Switch value={rights} onValueChange={setRights} />
          </View>
          <View style={S.between}>
            <Txt style={{ flex: 1 }}>
              광고주와 약정한 보상·예산을 실제 확보했고, 기입한 비용과 사용
              조건을 확인했어요.
            </Txt>
            <Switch value={funded} onValueChange={setFunded} />
          </View>
          <Button
            label="초안 저장"
            disabled={!rights || !funded || answers.length < 2}
            busy={m.isPending}
            onPress={() => void save()}
          />
        </View>
      )}
      <Section title="캠페인 및 집계" />
      {q.data?.campaigns.map((c) => (
        <View
          key={c.id}
          style={[S.card, selected === c.id ? { borderColor: C.purple } : {}]}
        >
          <Txt bold size={18}>
            {c.title}
          </Txt>
          <Txt size={13}>
            {c.brand} · {c.status} · 참여 가능 재고 {c.available}개
          </Txt>
          <Txt size={13}>
            시작 {c.starts} · 완주한 도전 {c.completed_playbacks} · 재도전{" "}
            {c.retries} · 성공 {c.successes} · 지급 {c.issued}
          </Txt>
          <Txt size={12}>
            직접 사용 표시 {c.self_reported_used} (브랜드 확인 실적 아님)
          </Txt>
          <Txt size={13}>
            예산 {c.budget.toLocaleString()}원 · 확보 {c.held.toLocaleString()}
            원 · 지급 원가 {c.spent.toLocaleString()}원
          </Txt>
          {q.data?.canManage && (
            <Button
              small
              secondary
              label="이 캠페인 관리"
              onPress={() => {
                setSelected(c.id);
                setCodes("");
                setBudget(String(c.budget));
              }}
            />
          )}
        </View>
      ))}
      {active && q.data?.canManage && (
        <View style={S.card}>
          <Txt bold>{active.title} 운영</Txt>
          <Txt size={12}>
            등록된 소재와 보상 조건은 고정돼요. 조건을 바꾸려면 별도 초안을
            만들어 검토한 후 공개해 주세요. 기존 참여자의 확보 보상과 조건은
            유지돼요.
          </Txt>
          <Field
            label="고유 쿠폰 코드 · 한 줄에 하나, 최대 100개"
            value={codes}
            onChangeText={setCodes}
            multiline
            autoCorrect={false}
            autoCapitalize="none"
          />
          <Field
            label="공통 유효기간 · YYYY-MM-DDTHH:mm:ss+09:00"
            value={validUntil}
            onChangeText={setValidUntil}
          />
          <Button
            secondary
            label="확보한 쿠폰 등록"
            disabled={!codes.trim()}
            busy={m.isPending}
            onPress={() => void inventory()}
          />
          <Field
            label="확보한 총 예산 (원)"
            value={budget}
            onChangeText={setBudget}
            keyboardType="number-pad"
          />
          <Field
            label="운영 변경 사유 · 5자 이상"
            value={reason}
            onChangeText={setReason}
          />
          <View style={S.wrap}>
            {[
              ["published", "최종 확인 · 공개"],
              ["paused", "새 참여 중단"],
              ["ended", "캠페인 종료"],
            ].map(([v, l]) => (
              <Button
                key={v}
                small
                secondary
                label={l}
                disabled={reason.trim().length < 5}
                busy={m.isPending}
                onPress={() =>
                  void mutate(
                    "/brand-admin/campaigns/" + selected + "/actions",
                    { status: v, reason, budget: Number(budget) },
                  )
                }
              />
            ))}
          </View>
        </View>
      )}
      <Section title="지급 확인·문의" />
      {q.data?.issues.map((i) => (
        <View key={i.id} style={S.card}>
          <Txt bold>{i.title}</Txt>
          <Txt size={13}>{i.status}</Txt>
          <Txt>{i.issue || "지급 상태를 확인해 주세요."}</Txt>
          {q.data?.canManage && (
            <>
              <Field
                label="확인 내용·사용자에게 보낼 답변"
                value={issueReason}
                onChangeText={setIssueReason}
              />
              <Button
                secondary
                label="확인 내용 저장"
                disabled={issueReason.length < 5}
                busy={m.isPending}
                onPress={() =>
                  void mutate("/brand-admin/rewards/" + i.id + "/resolve", {
                    reason: issueReason,
                    retry: false,
                  })
                }
              />
              {i.status === "needs_reconciliation" && (
                <Button
                  secondary
                  label="원인 조치 후 동일 보상 지급 재시도"
                  disabled={issueReason.length < 5}
                  onPress={() =>
                    void mutate("/brand-admin/rewards/" + i.id + "/resolve", {
                      reason: issueReason,
                      retry: true,
                    })
                  }
                />
              )}
            </>
          )}
        </View>
      ))}
      {message && <Notice>{message}</Notice>}
    </Frame>
  );
}
