/** Published DavaQ legal pages. Keep these independent of the app's SPA routes. */
export const DAVAQ_LEGAL_URLS = {
  privacy: "https://smileonlabs.github.io/davaqapp/privacy.html",
  accountDeletion: "https://smileonlabs.github.io/davaqapp/delete-account.html",
} as const;

export const DAVAQ_SUPPORT_EMAIL = "contact@smileon.app";
export const DAVAQ_LEGAL_LINK_ERROR =
  `안내 페이지를 열지 못했어요. ${DAVAQ_SUPPORT_EMAIL}으로 문의해 주세요.`;
