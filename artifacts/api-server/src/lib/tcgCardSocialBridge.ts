import type { Sql } from "./tcgService";
import { demand } from "./tcgCatalog";
export const basicCard = (id: string, title = id) => ({
  id,
  saveId: id,
  saveAllowed: true,
  title,
  imageSrc: null,
  amount: null,
  gameCode: "",
});
export async function registerListingCard(
  sql: Sql,
  listing: { card_id: string; card_name: string },
) {
  await sql.query(
    "INSERT INTO tcg_card_catalog(card_id,card) VALUES($1,$2) ON CONFLICT(card_id) DO NOTHING",
    [
      listing.card_id,
      JSON.stringify(basicCard(listing.card_id, listing.card_name)),
    ],
  );
}
export async function mirrorListingLike(
  sql: Sql,
  listing: { card_id: string; card_name: string },
  user: string,
  liked: boolean,
) {
  await registerListingCard(sql, listing);
  if (liked)
    await sql.query(
      "INSERT INTO tcg_card_likes(card_id,owner_id,source) VALUES($1,$2,'legacy') ON CONFLICT DO NOTHING",
      [listing.card_id, user],
    );
  else
    await sql.query(
      `DELETE FROM tcg_card_likes a WHERE a.card_id=$1 AND a.owner_id=$2 AND a.source='legacy'
    AND NOT EXISTS(SELECT 1 FROM tcg_listing_likes old JOIN tcg_listings l ON l.id=old.listing_id JOIN tcg_collection c ON c.id=l.collection_id WHERE c.card_id=$1 AND old.owner_id=$2)`,
      [listing.card_id, user],
    );
}
export async function mirrorListingComment(
  sql: Sql,
  listing: { card_id: string; card_name: string },
  item: any,
) {
  await registerListingCard(sql, listing);
  const prior = (
    await sql.query(
      "SELECT id FROM tcg_card_comments WHERE owner_id=$1 AND request_key=$2",
      [item.owner_id, item.request_key],
    )
  ).rows[0];
  demand(
    !prior || prior.id === item.id,
    409,
    "다른 댓글에 사용한 요청입니다. 다시 시도해 주세요.",
  );
  await sql.query(
    `INSERT INTO tcg_card_comments(id,card_id,owner_id,body,request_key,created_at)
     SELECT a.id,$2,a.owner_id,a.body,a.request_key,a.created_at FROM tcg_listing_comments a WHERE a.id=$1
     ON CONFLICT DO NOTHING`,
    [item.id, listing.card_id],
  );
}
