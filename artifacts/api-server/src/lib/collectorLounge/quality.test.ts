import {it,expect,vi,beforeEach} from 'vitest';
const mock=vi.hoisted(()=>({create:vi.fn()}));
vi.mock('../aiClient',()=>({getOpenAI:()=>({chat:{completions:{create:mock.create}}})}));
import {checkedCollectorReply,conversationContext,generationContext,collectorDraftText,repairInstructions,turnUtterance,asksMember,memberBoundaries,inventedExperience,type QualityOptions} from './quality';
import type {LoungeMessage} from './policy';
const msg=(content:string,author_kind='bot',room_seq=1):LoungeMessage=>({id:String(room_seq),sender_id:'x',author_kind,room_seq,content,type:'text',created_at:new Date()});
const completion=(content:string,n=100)=>({choices:[{message:{content}}],usage:{total_tokens:n}});
const verdict=(decision='accept')=>completion(JSON.stringify({decision,note:''}),40);
function opts(extra:Partial<QualityOptions>={}):QualityOptions{return {history:[],memberPending:false,evidence:{},draft:vi.fn().mockResolvedValue(completion('소파가 오늘의 최종 목적지네.')),onTokens:vi.fn(),...extra};}
beforeEach(()=>{mock.create.mockReset();});
it('preserves member rejection beyond twelve bot turns without inventing preferences',()=>{
 const h=[msg('음악 얘기 그만. 질문도 하지 마.', 'user',0),...Array.from({length:30},(_,i)=>msg('커피 풍경 이야기 '+i,'bot',i+1))];
 const c=conversationContext(h);expect(c.memberStatements[0].text).toContain('그만');expect(c.recent).toHaveLength(12);expect(c.earlierPoints.length).toBeGreaterThan(6);
});
it.each(['repeat','intent','experience','unsupported'])('repairs %s once and only publishes the audited replacement',async decision=>{
 mock.create.mockResolvedValueOnce(verdict(decision)).mockResolvedValueOnce(verdict());const draft=vi.fn().mockResolvedValueOnce(completion('가볍게 쉬는 게 좋겠네.')).mockResolvedValueOnce(completion('그럼 음악 얘기는 접자. 오늘은 말 없이 쉬어도 돼.'));
 const o=opts({draft,memberPending:true});expect(await checkedCollectorReply(o)).toContain('음악 얘기는 접자');expect(draft).toHaveBeenCalledTimes(2);expect(draft.mock.calls[1][0]).toContain(decision);expect(o.onTokens).toHaveBeenCalledTimes(4);
});
it('skips semantic duplicates after bounded repairs without sending an unchecked reply',async()=>{mock.create.mockResolvedValue(verdict('repeat'));await expect(checkedCollectorReply(opts())).rejects.toThrow('collector_quality_skipped');expect(mock.create).toHaveBeenCalledTimes(2);});
it('does not call the judge for an autonomous literal duplicate',async()=>{const o=opts({history:[msg('소파가 오늘의 최종 목적지네.')]});await expect(checkedCollectorReply(o)).rejects.toThrow('collector_quality_skipped');expect(mock.create).not.toHaveBeenCalled();});
it.each(['bad-json','{}'])('fails closed on malformed judge output: %s',async raw=>{mock.create.mockResolvedValue(completion(raw));const o=opts({memberPending:true});expect(await checkedCollectorReply(o)).toContain('확인하지 못했어');expect(o.draft).toHaveBeenCalledOnce();});
it('bounds provider outages and never publishes the draft',async()=>{mock.create.mockRejectedValue(new Error('provider'));const o=opts();await expect(checkedCollectorReply(o)).rejects.toThrow('collector_quality_skipped');expect(o.draft).toHaveBeenCalledOnce();});
it('provides current photo evidence to the vision reviewer',async()=>{mock.create.mockResolvedValue(verdict());const images=[{type:'image_url',image_url:{url:'data:image/png;base64,test'}}];await checkedCollectorReply(opts({images,model:'gpt-4o'}));const request=mock.create.mock.calls[0][0];expect(request.model).toBe('gpt-4o');expect(request.messages[1].content[1]).toEqual(images[0]);});
it('does not re-request a known unavailable private upload',async()=>{const o=opts({trustedUnavailable:true,draft:vi.fn().mockResolvedValue(completion('사진을 확인할 수 없어.'))});expect(await checkedCollectorReply(o)).toContain('확인할 수 없어');expect(mock.create).not.toHaveBeenCalled();});

it('catches implicit physical experience and keeps hypothetical opinions',()=>{
 expect(inventedExperience('내 방 바닥이 카드 같아.')).toBe(true);
 expect(inventedExperience('나는 카드 넘길 때 음악을 틀어.')).toBe(true);
 expect(inventedExperience('어제는 카드를 안 샀어.')).toBe(true);
 expect(inventedExperience('나는 AI라 직접 먹어본 적은 없어.')).toBe(false);
 expect(inventedExperience('나라면 식빵을 후보로 넣겠어.')).toBe(false);
});
it('keeps no-question consent until a member explicitly reopens questions',()=>{
 const h=[msg('질문이나 조언 말고 수다나 해.','user')];expect(memberBoundaries(h).noQuestions).toBe(true);
 h.push(msg('질문해도 돼.','user',2));expect(memberBoundaries(h).noQuestions).toBe(false);
});
it('blocks unwanted questions without trusting a permissive reviewer',async()=>{
 const o=opts({history:[msg('질문 그만.','user')],memberPending:true,draft:vi.fn().mockResolvedValue(completion('무슨 음악 좋아해?'))});expect(await checkedCollectorReply(o)).toContain('확인하지 못했어');expect(mock.create).not.toHaveBeenCalled();
});

it('removes rejected-topic and fabricated AI passages from generation without losing member intent',()=>{
 const h=[msg('음악 얘기 그만. 다른 얘기 하자.','user',1),msg('나는 카드 보며 음악을 틀어.','bot',2)];
 const c=generationContext(h);expect(c.boundaries.avoidedTopics).toContain('음악');expect(c.recent.filter(m=>m.kind==='bot')).toHaveLength(0);expect(c.memberStatements[0].text).not.toContain('음악');expect(c.topicChangeRequested).toBe(true);
 expect(conversationContext(h).boundaries.avoidedTopics).toContain('음악');
});
it('does not allow a hypothetical sentence to hide a separate fabricated experience',()=>{expect(inventedExperience('나라면 과자를 고를래. 어제 카드를 샀어.')).toBe(true);});
it('separates rhetorical imagination from requests for a member answer',()=>{expect(asksMember('휴일도 출근표가 있으면 웃기지 않을까?')).toBe(false);expect(asksMember('너는 무슨 음악 좋아해?')).toBe(true);});
it('unwraps structured replies and drops broken envelopes',()=>{expect(collectorDraftText(JSON.stringify({kind:'opinion',newPoint:'휴일',reply:'쉬는 날에 할 일만 늘어나면 그건 업무지.'}))).toContain('쉬는 날');expect(collectorDraftText('{')).toBe('');expect(collectorDraftText(JSON.stringify({kind:'experience',reply:'어제 샀어.'}))).toBe('');});
it('retains no-advice requests until explicit permission and exposes them to the judge',()=>{
 const h=[msg('질문이나 조언 말고 그냥 수다나 해.','user')];
 expect(conversationContext(h).boundaries.noAdvice).toBe(true);
 h.push(msg('이제 조언해 줘.','user',2));expect(memberBoundaries(h).noAdvice).toBe(false);
});

it('allows explicit inability without allowing a following fabricated sentence',()=>{expect(inventedExperience('나는 카드를 사거나 먹으면서 깔 수는 없거든.')).toBe(false);expect(inventedExperience('나는 카드를 깔 수는 없어. 어제 카드를 샀어.')).toBe(true);});

it('clears stale AI wording only for a fresh autonomous repair while retaining member boundaries',()=>{const h=[msg('음악 얘기는 그만. 질문 더 하지 마.','user'),msg('냉장고가 야근 당직이네.','bot',2)];const c=generationContext(h,true);expect(c.recent.every(m=>m.kind==='user')).toBe(true);expect(c.boundaries.noQuestions).toBe(true);expect(c.boundaries.avoidedTopics).toContain('음악');expect(turnUtterance(h,false,true)).toBe('새로운 얘기');expect(repairInstructions('repeat:',true)).toBe('');});
it('allows an audited answer to a repeated current member question',async()=>{mock.create.mockResolvedValue(verdict());const text='이 카드의 번호는 ST01-006-C야.';const o=opts({memberPending:true,history:[msg(text),msg('번호 다시 알려줘.','user',2)],draft:vi.fn().mockResolvedValue(completion(text))});expect(await checkedCollectorReply(o)).toBe(text);expect(mock.create).toHaveBeenCalledOnce();});

it('rejects omitted-subject sensory experience found in real dialogue while allowing explicit hypotheses',()=>{expect(inventedExperience('뭐 하나 정리하면 하루가 단단해진 느낌이더라.')).toBe(true);expect(inventedExperience('나라면 한 가지만 끝냈다고 상상할래.')).toBe(false);});
it('reviews an AI-to-AI question without treating it as a forbidden member interview',async()=>{mock.create.mockResolvedValue(verdict());const o=opts({history:[msg('질문 그만. 너희끼리 얘기해.','user')],memberPending:false,draft:vi.fn().mockResolvedValue(completion('너는 그 가정에서 어떤 선택이 더 낫다고 생각해?'))});expect(await checkedCollectorReply(o)).toContain('어떤 선택');expect(mock.create).toHaveBeenCalledOnce();});
