export type QuestMetric =
  | "chat"
  | "feedReaction"
  | "attendance"
  | "battle"
  | "dungeonAction"
  | "clanContribution"
  | "analysis"
  | "dailyCompleted";

export interface QuestDef {
  key: string;
  type: "daily" | "weekly";
  title: string;
  description: string;
  target: number;
  rewardExp: number;
  metric: QuestMetric;
}

export const DAILY_QUESTS: QuestDef[] = [
  {
    key: "daily_talk",
    type: "daily",
    title: "채팅 참여",
    description: "채팅에서 메시지를 한 번 보내세요.",
    target: 1,
    rewardExp: 10,
    metric: "chat",
  },
  {
    key: "daily_like",
    type: "daily",
    title: "좋아요 미션",
    description: "피드에서 마음에 드는 글을 한 번 응원하세요.",
    target: 1,
    rewardExp: 10,
    metric: "feedReaction",
  },
  {
    key: "daily_attendance",
    type: "daily",
    title: "출석 미션",
    description: "오늘 DavaQ에 접속하세요.",
    target: 1,
    rewardExp: 10,
    metric: "attendance",
  },
  {
    key: "daily_dungeon",
    type: "daily",
    title: "STAR 미션",
    description: "STAR 미션에서 3번 선택하세요.",
    target: 3,
    rewardExp: 15,
    metric: "dungeonAction",
  },
];

export const WEEKLY_QUESTS: QuestDef[] = [
  {
    key: "weekly_dungeon",
    type: "weekly",
    title: "STAR 미션 마스터",
    description: "STAR 미션에서 20번 선택하세요.",
    target: 20,
    rewardExp: 100,
    metric: "dungeonAction",
  },
  {
    key: "weekly_clan",
    type: "weekly",
    title: "팬클럽의 기둥",
    description: "팬클럽 활동을 5번 하세요.",
    target: 5,
    rewardExp: 120,
    metric: "clanContribution",
  },
  {
    key: "weekly_growth",
    type: "weekly",
    title: "꾸준한 팬 활동",
    description: "일일 퀘스트를 5개 완료하세요.",
    target: 5,
    rewardExp: 150,
    metric: "dailyCompleted",
  },
];
