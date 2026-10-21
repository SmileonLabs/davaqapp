import { DAVAQ_LEGAL_URLS, DAVAQ_SUPPORT_EMAIL } from "./davaqLegal";

// This version was approved by the DavaQ operator before publication.
export const DAVAQ_COMMUNITY_RULES_VERSION = "2026-10-15.1";
export const DAVAQ_COMMUNITY_RULES_TITLE = "DAVAQ 커뮤니티·이용 규칙";
export const DAVAQ_COMMUNITY_RULES_IS_DRAFT = false;
export const DAVAQ_COMMUNITY_RULES = [
  {
    title: "1. 이용 대상과 적용 범위",
    paragraphs: [
      "DAVAQ는 만 13세 이상을 위한 TCG 카드 시세 조회, 실물 카드 교환·나눔과 소통 서비스입니다.",
      "이 규칙은 프로필, 카드 사진·설명, 오퍼·거래 제안, 댓글, 채팅과 공유하는 사진·영상 등 사용자가 작성하거나 올리는 콘텐츠에 적용됩니다.",
    ],
  },
  {
    title: "2. 올리거나 공유할 수 없는 콘텐츠",
    paragraphs: [
      "아동·청소년 성적 학대·착취 콘텐츠, 성착취를 돕는 행위, 개인의 성적 노출·음란물 공유와 성적 서비스의 홍보·거래를 금지합니다.",
      "잔혹한 실사폭력, 폭력 위협, 괴롭힘과 혐오·차별을 조장하는 콘텐츠를 금지합니다.",
      "도박, 술·담배의 홍보·판매, 데이트·만남 알선, 불법 거래를 금지합니다.",
      "사기, 사칭, 스팸, 타인의 개인정보 무단 공개, 타인의 저작권 등 권리를 침해하는 콘텐츠를 금지합니다.",
    ],
  },
  {
    title: "3. 카드 등록과 교환·나눔",
    paragraphs: [
      "직접 보유하거나 등록 권한이 있는 실물 카드를 올리고, 사진·상태·수량과 교환·나눔 조건을 사실에 맞게 설명해 주세요.",
      "위조품을 정품으로 속이거나 타인의 사진·정보를 도용해 거래를 제안하지 마세요.",
      "DAVAQ는 현금 충전·송금·현금화, 암호화폐·NFT 판매·보상을 제공하지 않습니다.",
    ],
  },
  {
    title: "4. 안전한 소통과 신고",
    paragraphs: [
      "상대방을 존중하고, 동의 없이 민감한 정보나 사적인 사진·영상을 공유하지 마세요.",
      "규칙 위반이 의심되는 콘텐츠나 사용자는 앱의 신고·차단 기능으로 알려 주세요. 비밀번호나 인증 코드는 신고에 적지 마세요.",
      "규칙 위반 콘텐츠와 계정은 운영 검토 후 콘텐츠 노출 제한·삭제 또는 이용 제한 대상이 될 수 있습니다.",
    ],
  },
  {
    title: "5. 개인정보와 문의",
    paragraphs: [
      "개인정보 처리와 계정·데이터 삭제 요청은 아래 안내에서 확인해 주세요.",
      `규칙과 신고에 관한 문의: ${DAVAQ_SUPPORT_EMAIL}`,
    ],
  },
] as const;

export const DAVAQ_COMMUNITY_RELATED_LINKS = [
  { label: "개인정보처리방침", url: DAVAQ_LEGAL_URLS.privacy },
  { label: "계정·데이터 삭제 요청", url: DAVAQ_LEGAL_URLS.accountDeletion },
] as const;
