import React from "react";
import { useAnalyzeMyPersona } from "@workspace/api-client-react";

export function usePersonaAnalysis({
  refetchPersona,
  refetchCard,
}: {
  refetchPersona: () => unknown;
  refetchCard: () => unknown;
}) {
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [analysisError, setAnalysisError] = React.useState<string | null>(null);
  const [analysisNotice, setAnalysisNotice] = React.useState<string | null>(null);
  const { mutate: analyze, isPending: isAnalyzing } = useAnalyzeMyPersona({
    mutation: {
      onMutate: () => {
        setAnalysisError(null);
        setAnalysisNotice(null);
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
      },
      onSuccess: () => {
        refetchPersona();
        refetchCard();
        setAnalysisNotice("AI 분석 결과는 이전 상세값으로 저장하지 않고, DavaQ 최근 반영 내역에 비동기로만 반영돼요. PVT는 Talk to Earn 보상에서만 지급됩니다.");
        refreshTimer.current = setTimeout(() => {
          refetchPersona();
          refetchCard();
        }, 18_000);
      },
      onError: (error: unknown) => {
        const data = (error as { data?: { message?: string } } | null)?.data;
        setAnalysisError(data?.message ?? "분석에 실패했어요. 잠시 후 다시 시도해 주세요.");
      },
    },
  });

  React.useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  return { analyze, isAnalyzing, analysisError, analysisNotice };
}
