import {getReadingDigest,readingForReply,readingFollowUp,readingQuestion,readingFooter,READING_INSTRUCTIONS} from './reading';
import {collectorCompletion} from './budget';
import {repairInstructions,checkedCollectorReply,generationContext,conversationContext,turnInstructions,turnUtterance,COLLECTOR_RESPONSE_FORMAT,collectorSampling} from './quality';
import {collectorSystemPrompt} from './dialogue';
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { getOpenAI } from "../aiClient";
import { logger } from "../logger";
import { getRoomDeliveryRecipients } from "../chatDelivery";
import { publishRealtimeEvent } from "../realtime";
import { sendPushToUser } from "../push";
import {collectorKnowledge,linkedCatalogId,knowledgeSource,KNOWLEDGE_INSTRUCTIONS,everydayMessage} from "./knowledge";
import {loadCollectorImages,selectImageMessages,imagesStillVisible,imageConversation,IMAGE_INSTRUCTIONS,IMAGE_UNAVAILABLE_REPLY,imageFailureCompletion} from "./images";
import {
  COLLECTORS,
  normalizeCollectorReply,
  collectorReplyAllowed,
  redact,
} from "./policy";

// Private replies never read/write the public lounge ontology or another room.
// Persistent leases/budgets survive restarts and multiple API replicas.
export async function runCollectorDirectTurn() {
  if (process.env.COLLECTOR_LOUNGE_ENABLED !== "true") return;
  const c = await pool.connect();
  let row: any;
  const token = randomUUID();
  try {
    await c.query("BEGIN");
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtext('collector-direct-budget'))",
    );
    const total =
      (
        await c.query(
          "SELECT coalesce(sum(daily_calls),0)::int n FROM collector_direct_chats WHERE daily_date=CURRENT_DATE",
        )
      ).rows[0]?.n ?? 0;
    if (total >= 200) {
      await c.query("COMMIT");
      return;
    }
    row = (
      await c.query(`SELECT d.*,r.last_message_seq,m.content,m.type,m.metadata,m.created_at,m.id AS trigger_id FROM collector_direct_chats d JOIN chat_rooms r ON r.id=d.room_id JOIN messages m ON m.room_id=r.id AND m.room_seq=r.last_message_seq
   WHERE r.type='direct' AND d.next_at<=now() AND (d.lease_until IS NULL OR d.lease_until<now()) AND (d.daily_date<>CURRENT_DATE OR d.daily_calls<20)
   AND m.author_kind='user' AND m.sender_id=d.owner_id AND m.deleted_at IS NULL AND m.room_seq>d.last_processed_seq
   AND (d.attempt_seq<>m.room_seq OR d.attempts<3) AND (SELECT count(*) FROM chat_room_members x WHERE x.room_id=r.id)=2
   AND EXISTS(SELECT 1 FROM chat_room_members x WHERE x.room_id=r.id AND x.user_id=d.owner_id AND x.hidden_at IS NULL)
   AND EXISTS(SELECT 1 FROM chat_room_members x WHERE x.room_id=r.id AND x.user_id=d.collector_id)
   AND NOT EXISTS(SELECT 1 FROM blocked_users b WHERE (b.blocker_user_id=d.owner_id AND b.blocked_user_id=d.collector_id) OR (b.blocker_user_id=d.collector_id AND b.blocked_user_id=d.owner_id))
   ORDER BY d.next_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`)
    ).rows[0];
    if (!row) {
      await c.query("COMMIT");
      return;
    }
    if(row.type==='image' && Number(row.metadata?.albumTotal)>Number(row.metadata?.albumIndex??0)+1 && Date.now()-new Date(row.created_at).getTime()<15000){await c.query("COMMIT");return;}
    await c.query(
      "UPDATE collector_direct_chats SET lease_token=$2,lease_until=now()+interval '2 minutes',daily_calls=CASE WHEN daily_date=CURRENT_DATE THEN daily_calls+1 ELSE 1 END,daily_date=CURRENT_DATE,attempts=CASE WHEN attempt_seq=$3 THEN attempts+1 ELSE 1 END,attempt_seq=$3,next_at=now()+interval '30 seconds' WHERE room_id=$1",
      [row.room_id, token, row.last_message_seq],
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  if (!row) return;
  try {
    const actor = COLLECTORS.find((a) => a.id === row.collector_id);
    if (!actor) throw new Error("collector_unknown");
    const history = (
      await pool.query(
        "SELECT id,author_kind,sender_id,type,content,room_seq,metadata,created_at FROM messages WHERE room_id=$1 AND deleted_at IS NULL AND room_seq<=$2 ORDER BY room_seq DESC LIMIT 40",
        [row.room_id, row.last_message_seq],
      )
    ).rows.reverse();
    const images=await loadCollectorImages(row.room_id,history,everydayMessage(row.type==="text"?row.content:""));
    const imageStart=images.requested?history.findIndex(m=>selectImageMessages(history).some(s=>s.id===m.id)):-1;
    const linked=linkedCatalogId(row.content,row.metadata?.collectorCardId);
    const evidence=await collectorKnowledge(images.requested||(!linked&&(readingQuestion(row.content)||readingFollowUp(row.content,history)))?'':row.content,images.requested?null:linked);
    const digest=!images.requested&&!linked&&evidence.state==='not_requested'&&(readingQuestion(row.content)||readingFollowUp(row.content,history))?await getReadingDigest():null;
    const reading=digest?readingForReply(digest,row.content,history):null;
    const readingEvidence=digest?{state:reading?'found':'unavailable',item:reading,market:digest.market}:null;
    const generationModel=(qualityRepair:string)=>images.parts.length ? (process.env.COLLECTOR_VISION_MODEL || "gpt-4o") : qualityRepair ? (process.env.COLLECTOR_REPAIR_MODEL || process.env.COLLECTOR_CHAT_MODEL || "gpt-5.4") : process.env.COLLECTOR_CHAT_MODEL || "gpt-5.4";
    const draft = async (qualityRepair:string) => images.requested && !images.parts.length ? {choices:[{message:{content:IMAGE_UNAVAILABLE_REPLY}}]} : await collectorCompletion(
      {
        model:generationModel(qualityRepair),
        response_format:COLLECTOR_RESPONSE_FORMAT,
        max_completion_tokens:generationModel(qualityRepair).startsWith('gpt-5.4')?1200:350,
        ...collectorSampling(generationModel(qualityRepair),images.requested ? 0.2 : 0.8),
        messages: [
          {
            role: "system",
            content: collectorSystemPrompt(actor)+"\n"+repairInstructions(qualityRepair,true)+"\n"+turnInstructions(history,true)+"\n"+READING_INSTRUCTIONS+"\n지금은 회원 한 명과의 비공개 1:1 대화다. 다른 방·회원의 내용을 가져오지 마라."+"\n"+KNOWLEDGE_INSTRUCTIONS+(images.requested?"\n"+IMAGE_INSTRUCTIONS:""),
          },
          {
            role: "user",
            content: [{type:"text",text:JSON.stringify({
              qualityRepair,memberPending:true,readingEvidence,
              dialogueContext:generationContext(images.requested?history.slice(Math.max(0,imageStart)):history),
              catalogEvidence:evidence,
              memberPhotos:{count:images.parts.length,unavailable:images.unavailable,descriptions:images.descriptions},
              conversation:generationContext(images.requested?history.slice(Math.max(0,imageStart)):history).recent,
            })},{type:"text",text:turnUtterance(history,true)},...images.parts],
          },
        ],
      },
      { timeout: 30000, maxRetries: 0 },
    ).catch(error=>imageFailureCompletion(error,images.requested));
    const checkedText=await checkedCollectorReply({complete:collectorCompletion,history:images.requested?history.slice(Math.max(0,imageStart)):history,memberPending:true,evidence:{catalogEvidence:evidence,readingEvidence},images:images.parts,model:process.env.COLLECTOR_VISION_MODEL||"gpt-4o",trustedUnavailable:images.requested&&!images.parts.length,draft,
      onTokens:()=>{}});
    const text=(images.parts.length&&images.unavailable?"일부 사진만 확인했어. ":"")+checkedText;
    if(!text||!collectorReplyAllowed(text))throw new Error("collector_reply_rejected");
    const deliveredText=text+knowledgeSource(evidence)+(reading?readingFooter(reading):'');
    const tx = await pool.connect();
    let message: any;
    try {
      await tx.query("BEGIN");
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `chat-policy:${[row.owner_id, actor.id].sort().join(":")}`,
      ]);
      const current = (
        await tx.query(
          "SELECT d.*,r.last_message_seq FROM collector_direct_chats d JOIN chat_rooms r ON r.id=d.room_id WHERE d.room_id=$1 FOR UPDATE OF d,r",
          [row.room_id],
        )
      ).rows[0];
      const allowed = await tx.query(
        `SELECT 1 FROM chat_room_members a JOIN chat_room_members b ON b.room_id=a.room_id WHERE a.room_id=$1 AND a.user_id=$2 AND b.user_id=$3 AND a.hidden_at IS NULL AND (SELECT count(*) FROM chat_room_members m WHERE m.room_id=a.room_id)=2 AND NOT EXISTS(SELECT 1 FROM blocked_users x WHERE (x.blocker_user_id=$2 AND x.blocked_user_id=$3) OR (x.blocker_user_id=$3 AND x.blocked_user_id=$2)) AND EXISTS(SELECT 1 FROM messages m WHERE m.id=$4 AND m.deleted_at IS NULL)`,
        [row.room_id, row.owner_id, actor.id, row.trigger_id],
      );
      if (
        current?.lease_token === token &&
        new Date(current.lease_until).getTime() > Date.now() &&
        current.last_message_seq === row.last_message_seq &&
        allowed.rows.length &&
        await imagesStillVisible(tx.query.bind(tx),row.room_id,images.references)
      ) {
        const seq = (
          await tx.query(
            "UPDATE chat_rooms SET last_message_seq=last_message_seq+1,last_message=$2,last_message_at=now(),updated_at=now() WHERE id=$1 RETURNING last_message_seq",
            [row.room_id, deliveredText],
          )
        ).rows[0].last_message_seq;
        message = (
          await tx.query(
            "INSERT INTO messages(room_id,sender_id,sender_profile_id,author_kind,type,content,room_seq,client_message_id,metadata) VALUES($1,$2,$2,'bot','text',$3,$4,$5,$6::jsonb) RETURNING id,room_seq",
            [
              row.room_id,
              actor.id,
              deliveredText,
              seq,
              token,
              JSON.stringify({
                collectorAi: true,
                collectorKey: actor.key,
                privateCollector: true,
                collectorReadingId:reading?.id??null,
                collectorReadingKind:reading?.kind??null,
                collectorImageSourceIds:images.sources.map(s=>s.id),
                collectorCatalogSourceIds:evidence.cards.map(c=>c.id),
              }),
            ],
          )
        ).rows[0];
        await tx.query(
          "UPDATE collector_direct_chats SET last_processed_seq=$2 WHERE room_id=$1",
          [row.room_id, seq],
        );
      }
      await tx.query(
        "UPDATE collector_direct_chats SET lease_token=NULL,lease_until=NULL WHERE room_id=$1 AND lease_token=$2",
        [row.room_id, token],
      );
      await tx.query("COMMIT");
    } catch (e) {
      await tx.query("ROLLBACK");
      throw e;
    } finally {
      tx.release();
    }
    if (message) {
      const recipients = await getRoomDeliveryRecipients(row.room_id, actor.id);
      await publishRealtimeEvent({
        type: "message.created",
        roomId: row.room_id,
        actorUserId: actor.id,
        userIds: recipients.realtimeUserIds,
        data: {
          messageId: message.id,
          messageType: "text",
          roomSeq: message.room_seq,
        },
      });
      if (recipients.pushUserIds.includes(row.owner_id))
        await sendPushToUser(row.owner_id, {
          title: actor.name,
          body: "새 답장이 도착했어요.",
          url: `/chat/${row.room_id}`,
          tag: `collector-${message.id}`,
        });
    }
  } catch (error) {
    const budgetStopped=error instanceof Error&&error.message==='collector_daily_budget_exhausted';
    logger.warn({ roomId: row.room_id }, "Collector private reply stopped");
    await pool.query(
      "UPDATE collector_direct_chats SET lease_token=NULL,lease_until=NULL,attempts=CASE WHEN $3::boolean THEN greatest(0,attempts-1) ELSE attempts END,next_at=CASE WHEN $3::boolean THEN ((now() AT TIME ZONE 'Asia/Seoul')::date+1)::timestamp AT TIME ZONE 'Asia/Seoul' ELSE now()+interval '1 minute' END WHERE room_id=$1 AND lease_token=$2",
      [row.room_id, token,budgetStopped],
    );
  }
}
export function startCollectorDirectWorker() {
  if (process.env.COLLECTOR_LOUNGE_ENABLED !== "true") return;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runCollectorDirectTurn()
      .catch(() => logger.warn("Collector private worker unavailable"))
      .finally(() => {
        running = false;
      });
  }, 5000);
  timer.unref();
  return () => clearInterval(timer);
}
