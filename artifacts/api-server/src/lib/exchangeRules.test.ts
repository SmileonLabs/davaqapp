import {describe,it,expect} from "vitest";
import {matchPair,categoryEligible,participantSide,confirmedMemoryUsable,overlaps,interval,listingInput,termsInput} from "./exchangeRules";
const a={id:"a",owner_id:"u1",mode:"offer",kind:"service",category:"voice",title:"발성",description:"",wanted_text:"",wanted_categories:["photo"],delivery:"offline",location:"서울",available_days:[6]};
const b={...a,id:"b",owner_id:"u2",category:"photo",wanted_categories:["voice"]};
describe("DavaQ matching and constraints",()=>{
 it("requires reciprocal wishes and different owners",()=>{expect(matchPair(a,b)).not.toBeNull();expect(matchPair(a,{...b,wanted_categories:["tech"]})).toBeNull();expect(matchPair(a,{...b,owner_id:"u1"})).toBeNull();});
 it("rejects incompatible schedules and offline regions",()=>{expect(matchPair(a,{...b,available_days:[1]})).toBeNull();expect(matchPair(a,{...b,location:"부산"})).toBeNull();});
 it("allows online matching across regions and explains unknown dates",()=>{const result=matchPair({...a,delivery:"online",available_days:[]},{...b,delivery:"online",location:"부산"});expect(result?.pending.join(" ")).toContain("날짜");});
 it("keeps restricted listings out of automatic publication",()=>{expect(categoryEligible({category:"goods",title:"위스키 교환",description:""})).toBe(false);expect(categoryEligible({category:"goods",title:"미술 도구",description:""})).toBe(true);});
 it("shows the correct giving side for each participant",()=>{expect(participantSide({proposer_id:"a",recipient_id:"b"},"b")).toBe("requested");expect(participantSide({proposer_id:"a",recipient_id:"b"},"c")).toBeNull();});
 it("does not reuse inferred, deleted or expired memory",()=>{expect(confirmedMemoryUsable({status:"candidate"})).toBe(false);expect(confirmedMemoryUsable({status:"deleted"})).toBe(false);expect(confirmedMemoryUsable({status:"confirmed",expires_at:"2020-01-01"})).toBe(false);});
 it("treats adjacent appointments as non-overlapping",()=>{const x=interval("2030-01-01T00:00:00Z",30);expect(overlaps(x,interval("2030-01-01T00:30:00Z",30))).toBe(false);expect(overlaps(x,interval("2030-01-01T00:29:00Z",30))).toBe(true);});
 it("rejects unbounded durations and unknown payload fields",()=>{expect(listingInput.safeParse({...a,durationMinutes:99999}).success).toBe(false);expect(termsInput.safeParse({offerStartsAt:"tomorrow"}).success).toBe(false);});
});
