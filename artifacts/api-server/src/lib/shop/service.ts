import { pool } from "@workspace/db";
import { demand } from "../tcgCatalog";
import { transaction, type Sql } from "../tcgService";
export { transaction };
export async function member(
  sql: Sql,
  shop: string,
  user: string,
  owner = false,
) {
  const m = (
    await sql.query(
      "SELECT role FROM davaq_shop_members WHERE shop_id=$1 AND user_id=$2",
      [shop, user],
    )
  ).rows[0];
  demand(
    m && (!owner || m.role === "owner"),
    403,
    owner ? "점주 권한이 필요합니다." : "매장 접근 권한이 없습니다.",
  );
  return m as { role: "owner" | "staff" };
}
export async function event(
  sql: Sql,
  shop: string,
  actor: string,
  action: string,
  target: string,
  data: unknown = {},
) {
  await sql.query(
    "INSERT INTO davaq_shop_events(shop_id,actor_id,action,target_id,data) VALUES($1,$2,$3,$4,$5)",
    [shop, actor, action, target, JSON.stringify(data)],
  );
}
export async function quote(sql: Sql, shop: string, id: string, lock = false) {
  const q = (
    await sql.query(
      `SELECT * FROM davaq_shop_quotes WHERE shop_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
      [shop, id],
    )
  ).rows[0];
  demand(q, 404, "견적을 찾을 수 없습니다.");
  return q;
}
export function editable(q: any, version: number) {
  demand(q.status === "draft", 409, "확정·취소된 견적은 변경할 수 없습니다.");
  demand(q.version === version, 409, "견적이 변경됐습니다. 새로고침해 주세요.");
}
export async function confirmQuote(
  shop: string,
  id: string,
  user: string,
  version: number,
) {
  return transaction(async (sql) => {
    await member(sql, shop, user, true);
    const q = await quote(sql, shop, id, true);
    if (q.status === "confirmed") return q;
    editable(q, version);
    const items = (
      await sql.query(
        "SELECT * FROM davaq_shop_quote_items WHERE quote_id=$1 AND decision='buy' ORDER BY id",
        [id],
      )
    ).rows;
    demand(items.length, 409, "매입할 카드가 없습니다.");
    for (const i of items) {
      const stock = (
        await sql.query(
          `INSERT INTO davaq_shop_stock(shop_id,quote_item_id,card_id,card_name,condition,quantity,unit_cost,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            shop,
            i.id,
            i.card_id,
            i.card_name,
            i.condition,
            i.quantity,
            i.unit_price,
            i.location,
          ],
        )
      ).rows[0];
      await sql.query(
        "INSERT INTO davaq_shop_stock_events(stock_id,actor_id,delta,reason,request_key) VALUES($1,$2,$3,$4,$5)",
        [stock.id, user, i.quantity, "매입 입고", `quote:${id}`],
      );
    }
    const saved = (
      await sql.query(
        "UPDATE davaq_shop_quotes SET status='confirmed',customer_confirmed_at=now(),confirmed_at=now(),version=version+1 WHERE id=$1 RETURNING *",
        [id],
      )
    ).rows[0];
    await event(sql, shop, user, "confirm_quote", id);
    return saved;
  });
}
export async function moveStock(
  shop: string,
  id: string,
  user: string,
  input: { delta: number; reason: string; requestKey: string },
) {
  return transaction(async (sql) => {
    await member(sql, shop, user);
    const stock = (
      await sql.query(
        "SELECT * FROM davaq_shop_stock WHERE id=$1 AND shop_id=$2 FOR UPDATE",
        [id, shop],
      )
    ).rows[0];
    demand(stock, 404, "재고를 찾을 수 없습니다.");
    const old = (
      await sql.query(
        "SELECT * FROM davaq_shop_stock_events WHERE stock_id=$1 AND request_key=$2",
        [id, input.requestKey],
      )
    ).rows[0];
    if (old) {
      demand(
        old.actor_id === user &&
          old.delta === input.delta &&
          old.reason === input.reason,
        409,
        "동일 요청 키의 내용이 다릅니다.",
      );
      return stock;
    }
    demand(stock.quantity + input.delta >= 0, 409, "재고가 부족합니다.");
    const saved = (
      await sql.query(
        "UPDATE davaq_shop_stock SET quantity=quantity+$2 WHERE id=$1 RETURNING *",
        [id, input.delta],
      )
    ).rows[0];
    await sql.query(
      "INSERT INTO davaq_shop_stock_events(stock_id,actor_id,delta,reason,request_key) VALUES($1,$2,$3,$4,$5)",
      [id, user, input.delta, input.reason, input.requestKey],
    );
    await event(sql, shop, user, "stock_movement", id, input);
    return saved;
  });
}
export async function threadAccess(
  shop: string,
  id: string,
  user: string,
  sql: Sql = pool,
  lock = false,
) {
  const t = (
    await sql.query(
      `SELECT * FROM davaq_shop_threads WHERE id=$1 AND shop_id=$2${lock ? " FOR UPDATE" : ""}`,
      [id, shop],
    )
  ).rows[0];
  demand(t, 404, "상담을 찾을 수 없습니다.");
  if (t.customer_id === user) return { thread: t, kind: "customer" as const };
  await member(sql, shop, user);
  return { thread: t, kind: "shop" as const };
}
