export type ShopMarketHistoryPoint = {
  shopCode: string;
  shopName: string;
  sourceProductId: string;
  displayName: string;
  conditionLabel: string | null;
  gradingLabel: string | null;
  priceType: "LISTED" | "SOLD";
  priceDate: string;
  amountMinor: number;
  currencyCode: string;
  observedAt: string;
};

