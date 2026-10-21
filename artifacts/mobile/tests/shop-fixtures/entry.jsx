// Browser component harness. Device/identity/catalog boundaries are explicit fixtures.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShopQuoteScan } from "../../components/shop/ShopQuoteScan";
import { ShopDesk, ShopConversation } from "../../components/shop/ShopDesk";
import { useLocalSearchParams } from "./router";
import { useRealtimeInvalidation } from "../../lib/realtime";
window.fixtureActor =
  new URLSearchParams(location.search).get("actor") ??
  sessionStorage.getItem("shop-fixture-actor") ??
  "owner";
sessionStorage.setItem("shop-fixture-actor", window.fixtureActor);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
function App() {
  useLocalSearchParams();
  useRealtimeInvalidation();
  if (location.pathname === "/shop/scan") return <ShopQuoteScan />;
  if (location.pathname === "/shop/conversation") return <ShopConversation />;
  return <ShopDesk />;
}
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={client}>
    <App />
  </QueryClientProvider>,
);
