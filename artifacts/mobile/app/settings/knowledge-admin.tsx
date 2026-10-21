import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/lib/davaqAuth";
import { Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CustomScrollView } from "@/components/CustomScroll";
import { useColors } from "@/hooks/useColors";
import { crossAlert } from "@/lib/crossAlert";
import {
  useChatKnowledgeCandidates,
  useAiCampaigns,
  useApproveKnowledgeReviewItem,
  useCreateAiCampaign,
  useCreateKnowledgeSource,
  useDeleteKnowledgeSource,
  useExtractKnowledgeSource,
  useGoogleKnowledgeSearch,
  useImportGoogleKnowledgeResult,
  useKnowledgeAdminMe,
  useKnowledgeOntologyPreview,
  useKnowledgeReviewItems,
  useKnowledgeSources,
  useRejectKnowledgeReviewItem,
  type ChatKnowledgeCandidate,
  type GoogleKnowledgeSearchResult,
  type KnowledgeSource,
  type KnowledgeOntologyPreview,
  type KnowledgeReviewItem,
} from "@/hooks/useKnowledge";

function formatAdminTime(value?: string | null) {
  if (!value) return "없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "알 수 없음";
  return date.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function countValue(value: number | undefined) {
  return Number.isFinite(value) ? value ?? 0 : 0;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sourceMetaText(source: KnowledgeSource) {
  const parts = [source.sourceType, source.status];
  if (typeof source.documentCount === "number") parts.push(`문서 ${source.documentCount}`);
  if (typeof source.reviewCount === "number") parts.push(`후보 ${source.reviewCount}`);
  if (source.latestJobStatus) parts.push(`최근 추출 ${source.latestJobStatus}`);
  return parts.join(" · ");
}

function sourceErrorText(error: string) {
  if (/403|fetch source|URL fetch failed/i.test(error) && !error.includes("본문 직접 입력")) {
    return `${error} · 원본 사이트가 서버 수집을 차단했을 수 있어요. 본문 직접 입력을 사용하세요.`;
  }
  return error;
}

export default function KnowledgeAdminScreen() {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const colors = useColors();
  const { data: admin, isLoading: isAdminLoading } = useKnowledgeAdminMe();
  const enabled = !!admin?.isAdmin;
  const { data: sources, isLoading: sourcesLoading } = useKnowledgeSources(enabled);
  const { data: reviewItems, isLoading: reviewLoading } = useKnowledgeReviewItems(enabled);
  const { data: approvedItems, isLoading: approvedLoading } = useKnowledgeReviewItems(enabled, "approved");
  const { data: ontologyPreview, isLoading: previewLoading, isFetching: previewFetching, refetch: refetchPreview } = useKnowledgeOntologyPreview(enabled);
  const { data: chatCandidates, isLoading: chatCandidatesLoading } = useChatKnowledgeCandidates(enabled);
  const { data: campaigns, isLoading: campaignsLoading } = useAiCampaigns(enabled);
  const createSource = useCreateKnowledgeSource();
  const extractSource = useExtractKnowledgeSource();
  const deleteSource = useDeleteKnowledgeSource();
  const googleSearch = useGoogleKnowledgeSearch();
  const importGoogleResult = useImportGoogleKnowledgeResult();
  const approveItem = useApproveKnowledgeReviewItem();
  const rejectItem = useRejectKnowledgeReviewItem();
  const createCampaign = useCreateAiCampaign();
  const visibleReviewItems = (reviewItems ?? []).filter((item) => item.itemType !== "chat_memory_candidate");
  const [sourceTitle, setSourceTitle] = React.useState("");
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [sourceBody, setSourceBody] = React.useState("");
  const [deletingSourceId, setDeletingSourceId] = React.useState<string | null>(null);
  const [googleQuery, setGoogleQuery] = React.useState("BIBI 비비 최근 활동");
  const [campaignTitle, setCampaignTitle] = React.useState("");
  const [campaignMessage, setCampaignMessage] = React.useState("");

  const handleCreateSource = async () => {
    const title = sourceTitle.trim();
    const url = sourceUrl.trim();
    const body = sourceBody.trim();
    if (!title || (!url && !body)) return;
    try {
      await createSource.mutateAsync({ title, url: url || undefined, body: body || undefined });
      setSourceTitle("");
      setSourceUrl("");
      setSourceBody("");
    } catch {
      crossAlert("오류", "수집 자료를 저장하지 못했습니다.");
    }
  };

  const handleCreateCampaign = async () => {
    const title = campaignTitle.trim();
    const messageTemplate = campaignMessage.trim();
    if (!title || !messageTemplate) return;
    try {
      await createCampaign.mutateAsync({ title, messageTemplate, triggerType: "manual" });
      setCampaignTitle("");
      setCampaignMessage("");
    } catch {
      crossAlert("오류", "캠페인 초안을 저장하지 못했습니다.");
    }
  };

  const handleGoogleSearch = async () => {
    const query = googleQuery.trim();
    if (!query) return;
    try {
      await googleSearch.mutateAsync({ query, num: 5 });
    } catch (err) {
      crossAlert("오류", errorMessage(err, "구글 검색을 실행하지 못했습니다. API 설정을 확인해 주세요."));
    }
  };

  const handleImportGoogleResult = async (result: GoogleKnowledgeSearchResult) => {
    try {
      await importGoogleResult.mutateAsync({
        title: result.title,
        url: result.link,
        query: googleSearch.data?.query ?? googleQuery.trim(),
        snippet: result.snippet,
        displayLink: result.displayLink,
        formattedUrl: result.formattedUrl,
      });
      crossAlert("저장됨", "검색 결과 URL을 수집 자료로 저장했습니다. 수집 자료 목록에서 추출을 실행해 주세요.");
    } catch (err) {
      crossAlert("오류", errorMessage(err, "검색 결과를 수집 자료로 저장하지 못했습니다."));
    }
  };

  const handleDeleteSource = (source: KnowledgeSource) => {
    crossAlert("수집 자료 삭제", `"${source.title}" 자료를 목록에서 삭제할까요? Review 대기/반려 후보는 숨겨지고, 이미 승인되어 Graph에 적용된 지식은 유지됩니다.`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: () => {
          setDeletingSourceId(source.id);
          void deleteSource.mutateAsync(source.id)
            .catch((err) => crossAlert("오류", errorMessage(err, "수집 자료를 삭제하지 못했습니다.")))
            .finally(() => setDeletingSourceId(null));
        },
      },
    ]);
  };

  if (!isAuthLoaded) {
    return <View style={[styles.loading, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  if (!isSignedIn) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (isAdminLoading) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.muted }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!admin?.isAdmin) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.muted, padding: 24 }]}>
        <Feather name="lock" size={28} color={colors.mutedForeground} />
        <Text style={[styles.lockTitle, { color: colors.foreground }]}>관리자 전용 화면</Text>
        <Text style={[styles.lockBody, { color: colors.mutedForeground }]}>AI 지식 수집과 review 권한이 없습니다.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.muted }]}>
      <CustomScrollView contentContainerStyle={styles.content}>
        <View style={[styles.hero, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
            <Feather name="cpu" size={22} color={colors.primary} />
          </View>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>AI 지식 관리자</Text>
          <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>수집 자료를 draft claim으로 추출하고, 승인된 항목만 Knowledge Graph에 반영합니다.</Text>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>온톨로지 미리보기</Text>
        {previewLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <OntologyPreviewCard
            preview={ontologyPreview}
            refreshing={previewFetching}
            onRefresh={() => void refetchPreview()}
          />
        )}

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>적용 방식</Text>
        <KnowledgeFlowCard />

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>구글 검색으로 자료 찾기</Text>
        <View style={[styles.formCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <TextInput value={googleQuery} onChangeText={setGoogleQuery} placeholder="검색어" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
          <Text style={[styles.formHelp, { color: colors.mutedForeground }]}>Google Programmable Search API로 URL을 찾고, 저장된 URL은 기존 수집 자료 추출/Review/승인 흐름을 탑니다.</Text>
          <Pressable
            onPress={() => void handleGoogleSearch()}
            disabled={!googleQuery.trim() || googleSearch.isPending}
            style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: !googleQuery.trim() || googleSearch.isPending ? 0.55 : 1 }]}
          >
            {googleSearch.isPending ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="search" size={16} color={colors.primaryForeground} />}
            <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>검색</Text>
          </Pressable>
        </View>
        {googleSearch.data?.results.length ? (
          <View style={styles.list}>
            {googleSearch.data.results.map((result) => (
              <GoogleSearchResultCard
                key={result.link}
                result={result}
                importing={importGoogleResult.isPending}
                onImport={() => void handleImportGoogleResult(result)}
              />
            ))}
          </View>
        ) : null}

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>대화 기반 지식 후보</Text>
        {chatCandidatesLoading ? <ActivityIndicator color={colors.primary} /> : null}
        <View style={styles.list}>
          {(chatCandidates ?? []).slice(0, 12).map((item) => (
            <ChatKnowledgeCandidateCard
              key={item.id}
              item={item}
              onApprove={() => void approveItem.mutateAsync(item.id).catch(() => crossAlert("오류", "대화 후보 승인에 실패했습니다."))}
              onReject={() => void rejectItem.mutateAsync(item.id).catch(() => crossAlert("오류", "대화 후보 반려에 실패했습니다."))}
            />
          ))}
          {!chatCandidatesLoading && !chatCandidates?.length ? <EmptyCard text="아직 대화에서 생성된 지식 후보가 없습니다." /> : null}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>수집 자료 추가</Text>
        <View style={[styles.formCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <TextInput value={sourceTitle} onChangeText={setSourceTitle} placeholder="제목" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
          <TextInput value={sourceUrl} onChangeText={setSourceUrl} placeholder="URL 선택 입력" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
          <TextInput value={sourceBody} onChangeText={setSourceBody} placeholder="본문 직접 입력" placeholderTextColor={colors.mutedForeground} multiline style={[styles.textArea, { color: colors.foreground, borderColor: colors.border }]} />
          <Pressable
            onPress={() => void handleCreateSource()}
            disabled={!sourceTitle.trim() || (!sourceUrl.trim() && !sourceBody.trim()) || createSource.isPending}
            style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: !sourceTitle.trim() || (!sourceUrl.trim() && !sourceBody.trim()) || createSource.isPending ? 0.55 : 1 }]}
          >
            {createSource.isPending ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="plus" size={16} color={colors.primaryForeground} />}
            <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>자료 저장</Text>
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>수집 자료</Text>
        {sourcesLoading ? <ActivityIndicator color={colors.primary} /> : null}
        <View style={styles.list}>
          {(sources ?? []).map((source) => (
            <View key={source.id} style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{source.title}</Text>
                <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>{sourceMetaText(source)}</Text>
                {source.latestJobError ? (
                  <Text style={[styles.cardError, { color: colors.destructive }]} numberOfLines={2}>
                    {sourceErrorText(source.latestJobError)}
                  </Text>
                ) : null}
              </View>
              <View style={styles.sourceActions}>
                <Pressable
                  onPress={() => void extractSource.mutateAsync(source.id).catch((err) => crossAlert("오류", errorMessage(err, "후보 지식을 추출하지 못했습니다.")))}
                  disabled={extractSource.isPending || deletingSourceId === source.id}
                  style={[styles.secondaryButton, { borderColor: colors.border, opacity: extractSource.isPending || deletingSourceId === source.id ? 0.55 : 1 }]}
                >
                  <Feather name="zap" size={15} color={colors.primary} />
                  <Text style={[styles.secondaryText, { color: colors.primary }]}>추출</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="수집 자료 삭제"
                  hitSlop={8}
                  onPress={() => handleDeleteSource(source)}
                  disabled={deleteSource.isPending}
                  style={[styles.iconButton, { borderColor: colors.border, opacity: deleteSource.isPending ? 0.55 : 1 }]}
                >
                  {deletingSourceId === source.id ? <ActivityIndicator size="small" color={colors.destructive} /> : <Feather name="trash-2" size={16} color={colors.destructive} />}
                </Pressable>
              </View>
            </View>
          ))}
          {!sourcesLoading && !sources?.length ? <EmptyCard text="아직 수집 자료가 없습니다." /> : null}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>Review 대기</Text>
        {reviewLoading ? <ActivityIndicator color={colors.primary} /> : null}
        <View style={styles.list}>
          {visibleReviewItems.map((item) => (
            <View key={item.id} style={[styles.reviewCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{item.title}</Text>
              <Text style={[styles.reviewBody, { color: colors.mutedForeground }]}>{item.body}</Text>
              <View style={styles.actions}>
                <Pressable onPress={() => void approveItem.mutateAsync(item.id).catch(() => crossAlert("오류", "승인 처리에 실패했습니다."))} style={[styles.actionButton, { backgroundColor: colors.primary }]}>
                  <Feather name="check" size={15} color={colors.primaryForeground} />
                  <Text style={[styles.actionText, { color: colors.primaryForeground }]}>승인</Text>
                </Pressable>
                <Pressable onPress={() => void rejectItem.mutateAsync(item.id).catch(() => crossAlert("오류", "반려 처리에 실패했습니다."))} style={[styles.actionButton, { backgroundColor: colors.destructiveMuted }]}>
                  <Feather name="x" size={15} color={colors.destructive} />
                  <Text style={[styles.actionText, { color: colors.destructive }]}>반려</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {!reviewLoading && visibleReviewItems.length === 0 ? <EmptyCard text="Review 대기 항목이 없습니다." /> : null}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>승인/적용됨</Text>
        {approvedLoading ? <ActivityIndicator color={colors.primary} /> : null}
        <View style={styles.list}>
          {(approvedItems ?? []).slice(0, 10).map((item) => (
            <AppliedReviewItem key={item.id} item={item} />
          ))}
          {!approvedLoading && !approvedItems?.length ? <EmptyCard text="아직 승인되어 Graph에 적용된 항목이 없습니다." /> : null}
        </View>

        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>캠페인 초안</Text>
        <View style={[styles.formCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <TextInput value={campaignTitle} onChangeText={setCampaignTitle} placeholder="캠페인 제목" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
          <TextInput value={campaignMessage} onChangeText={setCampaignMessage} placeholder="발송 메시지 템플릿" placeholderTextColor={colors.mutedForeground} multiline style={[styles.textArea, { color: colors.foreground, borderColor: colors.border }]} />
          <Pressable
            onPress={() => void handleCreateCampaign()}
            disabled={!campaignTitle.trim() || !campaignMessage.trim() || createCampaign.isPending}
            style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: !campaignTitle.trim() || !campaignMessage.trim() || createCampaign.isPending ? 0.55 : 1 }]}
          >
            {createCampaign.isPending ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Feather name="send" size={16} color={colors.primaryForeground} />}
            <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>캠페인 저장</Text>
          </Pressable>
        </View>
        {campaignsLoading ? <ActivityIndicator color={colors.primary} /> : null}
        <View style={styles.list}>
          {(campaigns ?? []).map((campaign) => (
            <View key={campaign.id} style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{campaign.title}</Text>
                <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>{campaign.triggerType} · {campaign.status}</Text>
              </View>
            </View>
          ))}
          {!campaignsLoading && !campaigns?.length ? <EmptyCard text="캠페인 초안이 없습니다." /> : null}
        </View>
      </CustomScrollView>
    </View>
  );
}

function KnowledgeFlowCard() {
  const colors = useColors();
  const steps = [
    {
      icon: "archive" as const,
      title: "1. 자료 저장",
      body: "제목과 URL/본문을 knowledge source로 저장합니다. 이 단계만으로는 BIBI 답변에 쓰이지 않습니다.",
    },
    {
      icon: "zap" as const,
      title: "2. 추출",
      body: "본문 또는 URL fetch 결과에서 문장 후보를 만들고 Review 대기 상태로 보냅니다. URL fetch가 403이면 본문 직접 입력이 필요합니다.",
    },
    {
      icon: "check-circle" as const,
      title: "3. 승인",
      body: "승인하면 해당 문장이 approved claim이 되고, source와 함께 Neo4j Knowledge Graph에 upsert됩니다.",
    },
    {
      icon: "message-square" as const,
      title: "4. 적용",
      body: "BIBI 답변 생성 시 최신 사용자 문장과 매칭되는 approved claim만 prompt 근거로 검색됩니다. 출처 title/url은 추적용으로 유지됩니다.",
    },
    {
      icon: "database" as const,
      title: "대화 기반 후보",
      body: "사용자 대화에서 선호/말투/습관/성향 신호가 보이면 민감정보를 가린 뒤 Review 대기 후보로 저장합니다. 승인하면 user AI memory와 persona ontology에 동기화됩니다.",
    },
  ];

  return (
    <View style={[styles.flowCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
      {steps.map((step, index) => (
        <View key={step.title} style={[styles.flowRow, { borderTopColor: colors.border, borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth }]}>
          <View style={[styles.flowIcon, { backgroundColor: `${colors.primary}16` }]}>
            <Feather name={step.icon} size={14} color={colors.primary} />
          </View>
          <View style={styles.flowText}>
            <Text style={[styles.flowTitle, { color: colors.foreground }]}>{step.title}</Text>
            <Text style={[styles.flowBody, { color: colors.mutedForeground }]}>{step.body}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function GoogleSearchResultCard({
  result,
  importing,
  onImport,
}: {
  result: GoogleKnowledgeSearchResult;
  importing: boolean;
  onImport: () => void;
}) {
  const colors = useColors();
  return (
    <View style={[styles.reviewCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.appliedHeader}>
        <View style={styles.appliedHeaderText}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{result.title}</Text>
          <Text style={[styles.searchResultUrl, { color: colors.primary }]} numberOfLines={1}>{result.displayLink ?? result.formattedUrl ?? result.link}</Text>
        </View>
        <Pressable
          onPress={onImport}
          disabled={importing}
          style={[styles.secondaryButton, { borderColor: colors.border, opacity: importing ? 0.55 : 1 }]}
        >
          {importing ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="download" size={15} color={colors.primary} />}
          <Text style={[styles.secondaryText, { color: colors.primary }]}>자료 저장</Text>
        </Pressable>
      </View>
      {result.snippet ? <Text style={[styles.reviewBody, { color: colors.mutedForeground }]}>{result.snippet}</Text> : null}
      <Text style={[styles.graphIdText, { color: colors.mutedForeground }]} numberOfLines={1}>{result.link}</Text>
    </View>
  );
}

function ChatKnowledgeCandidateCard({
  item,
  onApprove,
  onReject,
}: {
  item: ChatKnowledgeCandidate;
  onApprove: () => void;
  onReject: () => void;
}) {
  const colors = useColors();
  const isDraft = item.status === "draft";
  const userLabel = item.userNickname || item.userEmail || "사용자";
  return (
    <View style={[styles.reviewCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.appliedHeader}>
        <View style={styles.appliedHeaderText}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{item.title}</Text>
          <Text style={[styles.cardMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {userLabel} · {item.memoryType ?? "memory"} · 신뢰도 {item.confidence ?? "-"} · {formatAdminTime(item.createdAt)}
          </Text>
        </View>
        <View style={[styles.appliedBadge, { backgroundColor: isDraft ? `${colors.primary}14` : `${colors.online}18` }]}>
          <Feather name={isDraft ? "clock" : "check"} size={12} color={isDraft ? colors.primary : colors.online} />
          <Text style={[styles.appliedBadgeText, { color: isDraft ? colors.primary : colors.online }]}>{item.status}</Text>
        </View>
      </View>
      <Text style={[styles.reviewBody, { color: colors.mutedForeground }]}>{item.body}</Text>
      {item.sourceSnippet ? (
        <Text style={[styles.candidateSnippet, { color: colors.mutedForeground }]} numberOfLines={2}>
          원문: {item.sourceSnippet}
        </Text>
      ) : null}
      {isDraft ? (
        <View style={styles.actions}>
          <Pressable onPress={onApprove} style={[styles.actionButton, { backgroundColor: colors.primary }]}>
            <Feather name="check" size={15} color={colors.primaryForeground} />
            <Text style={[styles.actionText, { color: colors.primaryForeground }]}>승인</Text>
          </Pressable>
          <Pressable onPress={onReject} style={[styles.actionButton, { backgroundColor: colors.destructiveMuted }]}>
            <Feather name="x" size={15} color={colors.destructive} />
            <Text style={[styles.actionText, { color: colors.destructive }]}>반려</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function AppliedReviewItem({ item }: { item: KnowledgeReviewItem }) {
  const colors = useColors();
  const isChatCandidate = item.itemType === "chat_memory_candidate";
  return (
    <View style={[styles.appliedCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.appliedHeader}>
        <View style={styles.appliedHeaderText}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{item.title}</Text>
          <Text style={[styles.cardMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {isChatCandidate ? "User memory 승인" : "Graph 적용"} · {formatAdminTime(item.reviewedAt)} · {item.sourceTitle ?? (isChatCandidate ? "대화 기반" : "출처 없음")}
          </Text>
        </View>
        <View style={[styles.appliedBadge, { backgroundColor: `${colors.online}18` }]}>
          <Feather name="check" size={12} color={colors.online} />
          <Text style={[styles.appliedBadgeText, { color: colors.online }]}>approved</Text>
        </View>
      </View>
      <Text style={[styles.reviewBody, { color: colors.mutedForeground }]}>{item.body}</Text>
      <Text style={[styles.graphIdText, { color: colors.mutedForeground }]} numberOfLines={1}>
        {isChatCandidate ? "candidate id" : "claim id"}: {item.graphId}
      </Text>
      {item.sourceUrl ? (
        <Text style={[styles.graphIdText, { color: colors.mutedForeground }]} numberOfLines={1}>
          source url: {item.sourceUrl}
        </Text>
      ) : null}
    </View>
  );
}

function OntologyPreviewCard({
  preview,
  refreshing,
  onRefresh,
}: {
  preview?: KnowledgeOntologyPreview;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const colors = useColors();
  if (!preview) return <EmptyCard text="온톨로지 미리보기를 불러오지 못했습니다." />;

  const reviewTotal = Object.values(preview.reviewCounts).reduce((sum, count) => sum + countValue(count), 0);
  const extractedSources = preview.sources.filter((source) => source.documentCount > 0).length;
  const latestJob = preview.latestJobs[0];
  const graphClaims = preview.graph.claims.slice(0, 6);
  const graphSources = preview.graph.sources.slice(0, 4);
  const graphEntities = preview.graph.entities.slice(0, 8);

  return (
    <View style={[styles.previewCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.previewHeader}>
        <View style={styles.previewHeaderText}>
          <Text style={[styles.previewTitle, { color: colors.foreground }]}>BIBI Official Knowledge Graph</Text>
          <Text style={[styles.previewMeta, { color: colors.mutedForeground }]}>마지막 갱신 {formatAdminTime(preview.generatedAt)}</Text>
        </View>
        <Pressable
          onPress={onRefresh}
          disabled={refreshing}
          style={[styles.refreshButton, { borderColor: colors.border, opacity: refreshing ? 0.55 : 1 }]}
        >
          {refreshing ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="refresh-cw" size={14} color={colors.primary} />}
          <Text style={[styles.refreshText, { color: colors.primary }]}>새로고침</Text>
        </Pressable>
      </View>

      <View style={styles.previewMetricGrid}>
        <PreviewMetric label="자료" value={`${preview.sources.length}`} colors={colors} />
        <PreviewMetric label="추출 완료" value={`${extractedSources}`} colors={colors} />
        <PreviewMetric label="Review" value={`${reviewTotal}`} colors={colors} />
        <PreviewMetric label="Graph Claim" value={`${preview.graph.counts.claims}`} colors={colors} />
      </View>

      <View style={styles.previewStatusRow}>
        <View style={[styles.statusChip, { backgroundColor: preview.graph.available ? `${colors.online}18` : colors.destructiveMuted }]}>
          <Feather name={preview.graph.available ? "check-circle" : "alert-circle"} size={13} color={preview.graph.available ? colors.online : colors.destructive} />
          <Text style={[styles.statusChipText, { color: preview.graph.available ? colors.online : colors.destructive }]}>Neo4j {preview.graph.available ? "연결" : "미연결"}</Text>
        </View>
        {latestJob ? (
          <View style={[styles.statusChip, { backgroundColor: colors.muted }]}>
            <Feather name="zap" size={13} color={colors.primary} />
            <Text style={[styles.statusChipText, { color: colors.mutedForeground }]}>최근 추출 {latestJob.status}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.previewSection}>
        <Text style={[styles.previewSectionTitle, { color: colors.foreground }]}>수집 자료 흐름</Text>
        {preview.sources.slice(0, 4).map((source) => (
          <View key={source.id} style={[styles.previewSourceRow, { borderTopColor: colors.border }]}>
            <View style={styles.previewSourceText}>
              <Text style={[styles.previewSourceTitle, { color: colors.foreground }]} numberOfLines={1}>{source.title}</Text>
              <Text style={[styles.previewMeta, { color: colors.mutedForeground }]} numberOfLines={1}>{source.sourceType} · 문서 {source.documentCount} · 승인 {source.approvedReviewCount} · {source.url ?? "manual"}</Text>
            </View>
            <Text style={[styles.previewSmallBadge, { color: colors.primary, backgroundColor: `${colors.primary}12` }]}>후보 {source.draftReviewCount + source.approvedReviewCount + source.rejectedReviewCount}</Text>
          </View>
        ))}
        {preview.sources.length === 0 ? <Text style={[styles.previewBodyText, { color: colors.mutedForeground }]}>아직 수집 자료가 없습니다.</Text> : null}
      </View>

      <View style={styles.previewSection}>
        <Text style={[styles.previewSectionTitle, { color: colors.foreground }]}>온톨로지 구성</Text>
        {preview.graph.available ? (
          <>
            <View style={styles.entityChipRow}>
              {graphEntities.map((entity) => (
                <View key={entity.id} style={[styles.entityChip, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.entityType, { color: colors.primary }]}>{entity.type}</Text>
                  <Text style={[styles.entityName, { color: colors.foreground }]} numberOfLines={1}>{entity.name}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.previewMeta, { color: colors.mutedForeground }]}>Entity {preview.graph.counts.entities} · Source {preview.graph.counts.sources} · Claim {preview.graph.counts.claims}</Text>
          </>
        ) : (
          <Text style={[styles.previewBodyText, { color: colors.mutedForeground }]}>Neo4j 연결이 없어 Postgres 수집/Review 상태만 표시합니다.</Text>
        )}
      </View>

      {graphSources.length > 0 ? (
        <View style={styles.previewSection}>
          <Text style={[styles.previewSectionTitle, { color: colors.foreground }]}>Graph Source</Text>
          {graphSources.map((source) => (
            <Text key={source.id} style={[styles.previewBodyText, { color: colors.mutedForeground }]} numberOfLines={2}>
              {source.title} · {source.sourceType} · claim {source.claimCount}{source.url ? ` · ${source.url}` : ""}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.previewSection}>
        <Text style={[styles.previewSectionTitle, { color: colors.foreground }]}>반영된 Claim</Text>
        {graphClaims.length > 0 ? graphClaims.map((claim) => {
          const source = claim.sources[0];
          return (
            <View key={claim.id} style={[styles.claimPreview, { backgroundColor: colors.muted }]}>
              <Text style={[styles.claimPredicate, { color: colors.primary }]}>{claim.entityName} · {claim.predicate}</Text>
              <Text style={[styles.claimText, { color: colors.foreground }]}>{claim.text}</Text>
              <Text style={[styles.previewMeta, { color: colors.mutedForeground }]} numberOfLines={1}>출처 {source?.title ?? "없음"}{source?.url ? ` · ${source.url}` : ""}</Text>
            </View>
          );
        }) : <Text style={[styles.previewBodyText, { color: colors.mutedForeground }]}>아직 Graph에 반영된 claim이 없습니다.</Text>}
      </View>
    </View>
  );
}

function PreviewMetric({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.previewMetric, { backgroundColor: colors.muted }]}>
      <Text style={[styles.previewMetricValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.previewMetricLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function EmptyCard({ text }: { text: string }) {
  const colors = useColors();
  return (
    <View style={[styles.empty, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { alignItems: "center", flex: 1, gap: 10, justifyContent: "center" },
  lockTitle: { fontFamily: "Inter_700Bold", fontSize: 18 },
  lockBody: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center" },
  content: { gap: 14, padding: 16, paddingBottom: 36 },
  hero: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, gap: 8, padding: 18 },
  heroIcon: { alignItems: "center", borderRadius: 16, height: 44, justifyContent: "center", width: 44 },
  heroTitle: { fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: -0.5 },
  heroBody: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 20 },
  sectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 13, paddingHorizontal: 4 },
  flowCard: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  flowRow: { alignItems: "flex-start", flexDirection: "row", gap: 10, padding: 14 },
  flowIcon: { alignItems: "center", borderRadius: 10, height: 30, justifyContent: "center", width: 30 },
  flowText: { flex: 1, gap: 3, minWidth: 0 },
  flowTitle: { fontFamily: "Inter_700Bold", fontSize: 13, lineHeight: 18 },
  flowBody: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  previewCard: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, gap: 14, padding: 14 },
  previewHeader: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  previewHeaderText: { flex: 1, gap: 4, minWidth: 0 },
  previewTitle: { fontFamily: "Inter_700Bold", fontSize: 16, letterSpacing: -0.2 },
  previewMeta: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16 },
  refreshButton: { alignItems: "center", borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 5, paddingHorizontal: 10, paddingVertical: 7 },
  refreshText: { fontFamily: "Inter_700Bold", fontSize: 11 },
  previewMetricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  previewMetric: { borderRadius: 14, flexBasis: "47%", flexGrow: 1, gap: 2, padding: 12 },
  previewMetricValue: { fontFamily: "Inter_800ExtraBold", fontSize: 18 },
  previewMetricLabel: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  previewStatusRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  statusChip: { alignItems: "center", borderRadius: 999, flexDirection: "row", flexShrink: 1, gap: 5, maxWidth: "100%", paddingHorizontal: 9, paddingVertical: 6 },
  statusChipText: { flexShrink: 1, fontFamily: "Inter_700Bold", fontSize: 11, lineHeight: 15 },
  previewSection: { gap: 8 },
  previewSectionTitle: { fontFamily: "Inter_700Bold", fontSize: 13 },
  previewSourceRow: { alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 8, paddingTop: 8 },
  previewSourceText: { flex: 1, gap: 2, minWidth: 0 },
  previewSourceTitle: { fontFamily: "Inter_700Bold", fontSize: 13, lineHeight: 18 },
  previewSmallBadge: { borderRadius: 999, flexShrink: 0, fontFamily: "Inter_700Bold", fontSize: 11, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5 },
  previewBodyText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  entityChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  entityChip: { borderRadius: 12, flexShrink: 1, gap: 2, maxWidth: "100%", paddingHorizontal: 10, paddingVertical: 7 },
  entityType: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase" },
  entityName: { flexShrink: 1, fontFamily: "Inter_700Bold", fontSize: 12, lineHeight: 16 },
  claimPreview: { borderRadius: 14, gap: 5, padding: 12 },
  claimPredicate: { fontFamily: "Inter_700Bold", fontSize: 11 },
  claimText: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 18 },
  formCard: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, gap: 10, padding: 14 },
  formHelp: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  input: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, fontFamily: "Inter_400Regular", fontSize: 14, paddingHorizontal: 12, paddingVertical: 11 },
  textArea: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, fontFamily: "Inter_400Regular", fontSize: 14, minHeight: 96, padding: 12, textAlignVertical: "top" },
  primaryButton: { alignItems: "center", alignSelf: "flex-start", borderRadius: 999, flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 11 },
  primaryText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  list: { gap: 10 },
  card: { alignItems: "center", borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 12, padding: 14 },
  cardText: { flex: 1, gap: 4, minWidth: 0 },
  cardTitle: { fontFamily: "Inter_700Bold", fontSize: 14, lineHeight: 19 },
  cardMeta: { fontFamily: "Inter_400Regular", fontSize: 12 },
  cardError: { fontFamily: "Inter_500Medium", fontSize: 12, lineHeight: 17 },
  searchResultUrl: { fontFamily: "Inter_600SemiBold", fontSize: 11, lineHeight: 16 },
  secondaryButton: { alignItems: "center", borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  sourceActions: { alignItems: "center", flexDirection: "row", flexShrink: 0, gap: 8 },
  iconButton: { alignItems: "center", borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, height: 36, justifyContent: "center", width: 36 },
  reviewCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 10, padding: 14 },
  reviewBody: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 },
  appliedCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 9, padding: 14 },
  appliedHeader: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  appliedHeaderText: { flex: 1, gap: 4, minWidth: 0 },
  appliedBadge: { alignItems: "center", borderRadius: 999, flexDirection: "row", flexShrink: 0, gap: 4, paddingHorizontal: 8, paddingVertical: 5 },
  appliedBadgeText: { fontFamily: "Inter_700Bold", fontSize: 11 },
  graphIdText: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16 },
  candidateSnippet: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16 },
  actions: { flexDirection: "row", gap: 8 },
  actionButton: { alignItems: "center", borderRadius: 999, flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  actionText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  empty: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center" },
});
