import {getReadingDigest,selectReading,readingForReply,readingFollowUp,readingQuestion,readingFooter,READING_INSTRUCTIONS} from './reading';
import {collectorCompletion} from './budget';
import {repairInstructions,checkedCollectorReply,generationContext,conversationContext,turnInstructions,turnUtterance,COLLECTOR_RESPONSE_FORMAT,collectorSampling} from './quality';
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { getOpenAI } from "../aiClient";
import { logger } from "../logger";
import { publishRealtimeEvent } from "../realtime";
import { getRoomDeliveryRecipients } from "../chatDelivery";
import { retrieveApprovedClaimsForPrompt } from "../knowledgeGraph/core";
import {
  runKnowledgeGraphRead,
  runKnowledgeGraphWrite,
} from "../knowledgeGraph/client";
import { resolveCard, cardId, upstream } from "../tcgCatalog";
import { sendPushToUser } from "../push";
import {
  COLLECTORS,
  collectorPublicImage,
  collectorReplyAllowed,
  normalizeCollectorReply,
  redact,
  messageStillCurrent,
  type LoungeMessage,
  freeCollectorSpeaker,
} from "./policy";
import {loadCollectorImages,selectImageMessages,imagesStillVisible,imageConversation,IMAGE_INSTRUCTIONS,IMAGE_UNAVAILABLE_REPLY,imageFailureCompletion} from "./images";
import {collectorKnowledge,linkedCatalogId,knowledgeSource,KNOWLEDGE_INSTRUCTIONS,everydayMessage} from "./knowledge";
import {dialoguePlan,repeatsRecentPoint,collectorSystemPrompt,collectorPosition} from "./dialogue";

async function graphContext(roomId: string, speaker: string, query: string) {
  const tenant = `collector-room:${roomId}`;
  const claims = await retrieveApprovedClaimsForPrompt({
    tenantId: tenant,
    query,
    limit: 6,
  });
  const memories = await runKnowledgeGraphRead((tx) =>
    tx.run(
      `MATCH (m:Memory {tenantId:$tenant,privacyScope:'official_public',status:'approved'}) WHERE m.speaker=$speaker RETURN m.id AS id,m.text AS text ORDER BY m.createdAt DESC LIMIT 4`,
      { tenant, speaker },
    ),
  );
  const candidates=memories?.records??[];
  const live=candidates.length?(await pool.query('SELECT id,content FROM messages WHERE room_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL',[roomId,candidates.map(r=>r.get('id'))])).rows:[];
  const visible=new Map(live.map(m=>[m.id,m.content]));
  return {
    facts: claims,
    conversationMemory: candidates.filter(r=>visible.has(r.get("id"))).map(r=>visible.get(r.get("id"))),
  };
}
async function remember(
  roomId: string,
  speaker: string,
  id: string,
  text: string,
) {
  // Only the AI's own public utterance; never import private user persona/memory.
  await runKnowledgeGraphWrite(async (tx) => {
    await tx.run(
      `MERGE (t:GraphTenant {id:$tenant}) ON CREATE SET t.type='community',t.ownerId=$room
 MERGE (m:Memory {id:$id}) SET m.tenantId=$tenant,m.speaker=$speaker,m.text=$text,m.kind='ai_utterance',m.privacyScope='official_public',m.status='approved',m.createdAt=datetime()
 MERGE (t)-[:OWNS]->(m)`,
      { tenant: `collector-room:${roomId}`, room: roomId, speaker, id, text },
    );
    await tx.run(
      `MATCH(m:Memory {tenantId:$tenant}) WITH m ORDER BY m.createdAt DESC SKIP 120 DETACH DELETE m`,
      { tenant: `collector-room:${roomId}` },
    );
  });
}
async function reserve() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const row = (
      await c.query(`SELECT l.*,r.last_message_seq FROM collector_lounges l JOIN chat_rooms r ON r.id=l.room_id
 WHERE NOT l.paused AND (l.next_at<=now() OR EXISTS(SELECT 1 FROM messages pending WHERE pending.room_id=l.room_id AND pending.room_seq=r.last_message_seq AND pending.author_kind='user' AND pending.deleted_at IS NULL AND pending.room_seq>l.last_processed_seq AND NOT EXISTS(SELECT 1 FROM collector_lounge_runs attempted WHERE attempted.room_id=l.room_id AND attempted.trigger_seq=pending.room_seq))) AND (l.lease_until IS NULL OR l.lease_until<now())
 ORDER BY l.next_at FOR UPDATE OF l SKIP LOCKED LIMIT 1`)
    ).rows[0];
    if (!row) {
      await c.query("COMMIT");
      return null;
    }
    const sameDay = (
      await c.query("SELECT $1::date = CURRENT_DATE AS same", [row.daily_date])
    ).rows[0].same;
    const calls = sameDay ? row.daily_calls : 0,
      tokens = sameDay ? row.daily_tokens : 0;
    const history = (
      await c.query(
        `SELECT id,sender_id,author_kind,content,type,room_seq,created_at,metadata FROM messages WHERE room_id=$1 AND deleted_at IS NULL ORDER BY room_seq DESC LIMIT 40`,
        [row.room_id],
      )
    ).rows.reverse() as LoungeMessage[];
    const memberAnchors=(await c.query("SELECT id,sender_id,author_kind,content,type,room_seq,created_at,metadata FROM messages WHERE room_id=$1 AND deleted_at IS NULL AND author_kind='user' AND room_seq<=$2 ORDER BY room_seq DESC LIMIT 5",[row.room_id,row.last_message_seq])).rows as LoungeMessage[];
    for(const m of memberAnchors)if(!history.some(h=>h.id===m.id))history.push(m);
    history.sort((a,b)=>a.room_seq-b.room_seq);
    const last = history.at(-1);
    const pending = history.some(
      (m) => m.author_kind === "user" && m.room_seq > row.last_processed_seq,
    );
    if(pending && last?.type==='image' && Number(last.metadata?.albumTotal)>Number(last.metadata?.albumIndex??0)+1 && Date.now()-new Date(last.created_at).getTime()<15000){await c.query("COMMIT");return null;}
    const reservedTokens = selectImageMessages(history).length ? 48000 : 24000;
    if (
      calls >= row.daily_limit ||
      tokens + reservedTokens > row.daily_token_limit
    ) {
      await c.query(
        `UPDATE collector_lounges SET next_at=now()+interval '1 minute' WHERE room_id=$1`,
        [row.room_id],
      );
      await c.query("COMMIT");
      return null;
    }
    // Debounce member upload/text bursts; next_at controls autonomous pacing.
    if (last && Date.now() - new Date(last.created_at).getTime() < (pending ? 2000 : 8000)) {
      await c.query("COMMIT");
      return null;
    }
    const topicDue = history.length===0 && !pending;
    const failures = (
      await c.query(
        `SELECT count(*)::int AS count FROM collector_lounge_runs WHERE room_id=$1 AND trigger_seq=$2 AND status='failed' AND created_at>now()-interval '30 minutes'`,
        [row.room_id, row.last_message_seq],
      )
    ).rows[0].count;
    if (failures >= 3) {
      await c.query(
        `UPDATE collector_lounges SET episode_turns=4,next_at=now()+interval '30 minutes' WHERE room_id=$1`,
        [row.room_id],
      );
      await c.query("COMMIT");
      return null;
    }
    const run = randomUUID();
    const turns = pending || topicDue ? 0 : Number(row.episode_turns);
    await c.query(
      `UPDATE collector_lounges SET lease_token=$2,lease_until=now()+interval '2 minutes',next_at=now()+interval '1 hour',daily_date=CURRENT_DATE,daily_calls=$3+1,daily_tokens=$4::integer+$6::integer,last_topic_at=CASE WHEN $5 THEN now() ELSE last_topic_at END WHERE room_id=$1`,
      [row.room_id, run, calls, tokens, topicDue, reservedTokens],
    );
    await c.query(
      `INSERT INTO collector_lounge_runs(id,room_id,trigger_seq) VALUES($1,$2,$3)`,
      [run, row.room_id, row.last_message_seq],
    );
    await c.query("COMMIT");
    return { row, run, history, turns, topicDue, pending, reservedTokens };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function runCollectorLoungeTurn() {
  if (
    process.env.COLLECTOR_LOUNGE_ENABLED !== "true"
  )
    return;
  const job = await reserve();
  if (!job) return;
  const { row, run, history, turns, topicDue, pending, reservedTokens } = job;
  let actualTokens = reservedTokens;
  let stage = "decision";
  const startsTopic = topicDue && !pending;
  try {
    const autonomous = !pending;
    const actor = freeCollectorSpeaker(history);
    actualTokens=0;
    stage = "context";
    const sharedMessage=pending?history.filter(m=>m.author_kind==="user").at(-1):undefined;
    const everyday=pending&&everydayMessage(sharedMessage?.content??"");
    const images = await loadCollectorImages(row.room_id,history,startsTopic||everyday);
    const imageStart=images.requested?history.findIndex(m=>selectImageMessages(history).some(s=>s.id===m.id)):-1;
    const context = (autonomous || images.requested) ? {facts:[],conversationMemory:[]} : await graphContext(row.room_id, actor.key, redact(sharedMessage?.content??row.topic));
    let topic=row.topic, topicCardId=row.topic_card_id, topicGame:string|null=null;
    if(startsTopic){topic='자유 대화';topicCardId=null;}
    let card: any = null;
    let cardImage:string|null=null;
    const shared = pending ? history.filter(m=>m.author_kind === "user").at(-1) : undefined;
    const linked=linkedCatalogId(shared?.content??'',shared?.metadata?.collectorCardId);
    const publicQuestion=pending&&!images.requested&&!everyday&&!linked&&(readingQuestion(shared?.content??'')||readingFollowUp(shared?.content??'',history));
    const evidence=await collectorKnowledge(pending&&!images.requested&&!publicQuestion?shared?.content??"":"",images.requested?null:linked);
    const freeConversation=autonomous&&everydayMessage(history.filter(m=>m.author_kind==='user').at(-1)?.content??'');
    const wantsReading=pending&&!images.requested&&!everyday&&!linked&&evidence.state==='not_requested'&&(readingQuestion(shared?.content??'')||readingFollowUp(shared?.content??'',history));
    const digest=!images.requested&&!everyday&&!freeConversation&&(autonomous||wantsReading)?await getReadingDigest():null;
    const readingHistory=autonomous&&digest?Array.from(new Map([...history,...(await pool.query("SELECT id,sender_id,author_kind,content,type,room_seq,created_at,metadata FROM messages WHERE room_id=$1 AND author_kind='bot' AND metadata->>'collectorReadingId' IS NOT NULL AND deleted_at IS NULL AND created_at>now()-interval '7 days' ORDER BY room_seq DESC LIMIT 100",[row.room_id])).rows].map((m:LoungeMessage)=>[m.id,m])).values()).sort((a,b)=>a.room_seq-b.room_seq):history;
    const reading=digest?(wantsReading?readingForReply(digest,shared?.content??'',history):selectReading(digest,readingHistory)):null;
    if(autonomous&&!freeConversation&&!reading)throw Error('collector_no_reading_material');
    const readingEvidence=digest?{state:reading?'found':'unavailable',item:reading,market:digest.market}:null;
    const readingIntro=!!reading&&!readingHistory.some(m=>m.metadata?.collectorReadingId===reading.id);
    if(reading){topic=reading.title;topicCardId=reading.cardId??null;}
    const candidate = linked ?? (reading?.cardId??(reading?null:topicCardId));
    const parsedCard = cardId.safeParse(candidate);
    let activeCardId = images.requested||everyday ? null : evidence.state!=="not_requested" ? (evidence.cards.length===1?evidence.cards[0].id:null) : parsedCard.success ? parsedCard.data : null;
    if(evidence.cards.length===1){topic=evidence.cards[0].name+" 카드 이야기";}
    if(everyday){topic=redact(sharedMessage?.content??"일상 이야기");topicCardId=null;topicGame="everyday";}
    if(images.requested){topic="회원이 올린 카드 사진 이야기";topicCardId=null;}
    if (activeCardId && evidence.state==="not_requested")
      try {
        const detail = await resolveCard(activeCardId);
        // Public catalog values are not sufficient evidence for a current exact-printing price.
        const { value: _legacyValue, ...identity } = detail.target;
        if(readingIntro)topicGame=identity.game??null;
        cardImage=(!autonomous || startsTopic || readingIntro) ? collectorPublicImage(identity.imageSrc,upstream.origin) : null;
        card = {target:{id:identity.id,name:identity.name,game:identity.game,number:identity.number,set:identity.set}, ownership:'unknown', price:{state:'unavailable'}};
      } catch {
        card = { unavailable: true };
      }
    stage = "generation";
    const generationModel=(qualityRepair:string)=>images.parts.length ? (process.env.COLLECTOR_VISION_MODEL || "gpt-4o") : qualityRepair ? (process.env.COLLECTOR_REPAIR_MODEL || process.env.COLLECTOR_CHAT_MODEL || "gpt-5.4") :
          process.env.COLLECTOR_CHAT_MODEL || process.env.TCG_AI_MODEL || "gpt-5.4";
    const draft = async (qualityRepair:string) => images.requested && !images.parts.length ? {choices:[{message:{content:IMAGE_UNAVAILABLE_REPLY}}],usage:{total_tokens:0}} : await collectorCompletion(
      {
        model:generationModel(qualityRepair),
        response_format:COLLECTOR_RESPONSE_FORMAT,
        max_completion_tokens:generationModel(qualityRepair).startsWith('gpt-5.4')?1200:350,
        ...collectorSampling(generationModel(qualityRepair),images.requested ? 0.2 : 0.8),
        messages: [
          {
            role: "system",
            content: collectorSystemPrompt(actor)+"\n"+repairInstructions(qualityRepair,pending)+"\n"+turnInstructions(history,pending)+"\n"+READING_INSTRUCTIONS+"\n"+KNOWLEDGE_INSTRUCTIONS+(images.requested?"\n"+IMAGE_INSTRUCTIONS:""),
          },
          {
            role: "user",
            content: [{type:"text",text:JSON.stringify({
              qualityRepair,memberPending:pending,readingEvidence,readingIntro,
              dialogueContext:generationContext(images.requested?history.slice(Math.max(0,imageStart)):history,qualityRepair.startsWith('repeat:')&&!pending),
              topic: images.requested ? null : startsTopic ? topic : null,
              memberPhotos:{count:images.parts.length,unavailable:images.unavailable,descriptions:images.descriptions},
              turnGoal: dialoguePlan(turns,pending,startsTopic?[]:history).move,
              yourPosition: collectorPosition(actor.key,topic),
              replyingTo: startsTopic||qualityRepair.startsWith('repeat:')&&!pending?null:dialoguePlan(turns,pending,history).replyingTo,
              context: {facts:context.facts.slice(0,2),conversationMemory:(qualityRepair.startsWith('repeat:')&&!pending?[]:context.conversationMemory.slice(0,2)).map((m:any)=>String(m).slice(0,180))},
              card,
              catalogEvidence:evidence,
              conversation:generationContext(images.requested?history.slice(Math.max(0,imageStart)):history,qualityRepair.startsWith('repeat:')&&!pending).recent,
            })},{type:"text",text:turnUtterance(history,pending,qualityRepair.startsWith('repeat:')&&!pending)}, ...images.parts, ...(cardImage?[{type:"image_url" as const,image_url:{url:cardImage,detail:"low" as const}}]:[])],
          },
        ],
      },
      { timeout: 30000, maxRetries: 0 },
    ).catch(error=>imageFailureCompletion(error,images.requested));
    const checkedText=await checkedCollectorReply({complete:collectorCompletion,history:images.requested?history.slice(Math.max(0,imageStart)):history,memberPending:pending,evidence:{catalogEvidence:evidence,card,readingEvidence},images:images.parts,model:process.env.COLLECTOR_VISION_MODEL||"gpt-4o",trustedUnavailable:images.requested&&!images.parts.length,
      draft,
      onTokens:n=>{actualTokens+=n;}});
    const text=(images.parts.length&&images.unavailable?"일부 사진만 확인했어. ":"")+checkedText;
    if (!collectorReplyAllowed(text)) throw new Error("collector_unsupported_assertion");
    if (!pending && repeatsRecentPoint(text,history.slice(-40).filter(m=>m.author_kind==='bot').map(m=>m.content)))throw new Error('collector_duplicate_response');
    const deliveredText=text+knowledgeSource(evidence)+(reading&&readingIntro?readingFooter(reading):'');
    stage = "persistence";
    const c = await pool.connect();
    let message: any;
    try {
      await c.query("BEGIN");
      const state = (
        await c.query(
          `SELECT l.*,r.last_message_seq FROM collector_lounges l JOIN chat_rooms r ON r.id=l.room_id WHERE l.room_id=$1 FOR UPDATE OF l,r`,
          [row.room_id],
        )
      ).rows[0];
      if (
        state.paused ||
        state.lease_token !== run ||
        new Date(state.lease_until).getTime() < Date.now() ||
        !messageStillCurrent(row.last_message_seq, state.last_message_seq) ||
        !(await imagesStillVisible(c.query.bind(c),row.room_id,images.references))
      ) {
        await c.query(
          `UPDATE collector_lounge_runs SET status='superseded',completed_at=now() WHERE id=$1`,
          [run],
        );
      } else {
        const seq = (
          await c.query(
            `UPDATE chat_rooms SET last_message_seq=last_message_seq+1,last_message=$2,last_message_at=now(),updated_at=now() WHERE id=$1 RETURNING last_message_seq`,
            [row.room_id, deliveredText],
          )
        ).rows[0].last_message_seq;
        message = (
          await c.query(
            `INSERT INTO messages(room_id,sender_id,sender_profile_id,author_kind,type,content,client_message_id,room_seq,metadata) VALUES($1,$2,$2,'bot','text',$3,$4,$5,$6::jsonb) RETURNING *`,
            [
              row.room_id,
              actor.id,
              deliveredText,
              run,
              seq,
              JSON.stringify({
                collectorAi: true,
                collectorReadingId:reading?.id??null,
                collectorReadingKind:reading?.kind??null,
                collectorReadingUrl:reading?.url??null,
                collectorKey: actor.key,
                runId: run,
                aiLabel: "AI",
                topicCardId: readingIntro || turns === 0 ? activeCardId : null,
                topicGame: startsTopic||everyday||readingIntro ? topicGame : null,
                collectorImageSourceIds:images.sources.map(s=>s.id),
              collectorCatalogSourceIds:evidence.cards.map(c=>c.id),
              }),
            ],
          )
        ).rows[0];
        await c.query(
          `UPDATE collector_lounges SET last_processed_seq=$2,episode_turns=$3,last_ai_at=now(),topic=$4,topic_card_id=$5 WHERE room_id=$1`,
          [row.room_id, seq, turns + 1, topic, activeCardId],
        );
        await c.query(
          `UPDATE collector_lounge_runs SET status='sent',speaker=$2,input_tokens=$3,completed_at=now() WHERE id=$1`,
          [run, actor.key, actualTokens],
        );
      }
      await c.query(
        `UPDATE collector_lounges SET lease_token=NULL,lease_until=NULL,daily_tokens=greatest(0,daily_tokens-$4+$3) WHERE room_id=$1 AND lease_token=$2`,
        [row.room_id, run, actualTokens, reservedTokens],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    if (message) {
      stage = "delivery";
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
      stage = "memory";
      if(!images.requested)await remember(row.room_id, actor.key, message.id, text);
      const target = history.at(-1);
      if (
        target?.author_kind === "user" &&
        recipients.realtimeUserIds.includes(target.sender_id)
      ) {
        const member = (
          await pool.query(
            "SELECT muted FROM chat_room_members WHERE room_id=$1 AND user_id=$2",
            [row.room_id, target.sender_id],
          )
        ).rows[0];
        if (member && !member.muted)
          await sendPushToUser(target.sender_id, {
            title: actor.name,
            body: "수집가 라운지에서 내 메시지에 답변했어요.",
            url: `/chat/${row.room_id}`,
            tag: `collector-${message.id}`,
          });
      }
    }
  } catch (e) {
    const code =
      e instanceof Error && /^collector_[a-z0-9_]+$/.test(e.message)
        ? e.message
        : `collector_${stage}_failed`;
    // Do not log provider errors, request bodies or Authorization headers.
    if(code!=='collector_no_reading_material')logger.warn({ runId: run, code, errorType: e instanceof Error ? e.name : "unknown" }, "Collector lounge turn stopped");
    await pool.query(
      `UPDATE collector_lounge_runs SET status=CASE WHEN status='sent' THEN status WHEN $2='collector_no_reading_material' THEN 'skipped' ELSE 'failed' END,error_code=$2,completed_at=now() WHERE id=$1`,
      [run, code],
    );
    await pool.query(
      `UPDATE collector_lounges SET lease_token=NULL,lease_until=NULL,next_at=CASE WHEN $6::boolean THEN ((now() AT TIME ZONE 'Asia/Seoul')::date+1)::timestamp AT TIME ZONE 'Asia/Seoul' ELSE now()+CASE WHEN $3::boolean THEN interval '1 hour' ELSE interval '5 minutes' END END,daily_tokens=CASE WHEN $3::boolean THEN greatest(0,daily_tokens-$4+$5) ELSE daily_tokens END WHERE room_id=$1 AND lease_token=$2`,
      [row.room_id, run, code==='collector_quality_skipped'||code==='collector_daily_budget_exhausted'||code==='collector_no_reading_material',reservedTokens,actualTokens,code==='collector_daily_budget_exhausted'],
    );
  }
}
export function startCollectorLoungeWorker() {
  if (process.env.COLLECTOR_LOUNGE_ENABLED !== "true") return;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void runCollectorLoungeTurn()
      .catch(() => logger.warn("Collector lounge worker unavailable"))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, 3000);
  timer.unref();
  return () => clearInterval(timer);
}
