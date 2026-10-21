// @ts-nocheck -- executed by Node's type-stripping runner.
import test from 'node:test';import assert from 'node:assert/strict';
import {nextCallClock,formatCallDuration,callPrimaryStatus,cameraAllowed,clampCallPosition,callEndLabel} from './callPresentation.ts';
test('clock begins at local media readiness rather than ringing or API acceptance',()=>{let s={callId:null,startedAt:null};s=nextCallClock(s,'a',false,1000);assert.equal(s.startedAt,null);s=nextCallClock(s,'a',true,5000);assert.equal(s.startedAt,5000);s=nextCallClock(s,'a',false,8000);assert.equal(s.startedAt,5000);s=nextCallClock(s,'a',true,12000);assert.equal(s.startedAt,5000);});
test('new and ended calls cannot inherit a previous elapsed clock',()=>{let s=nextCallClock({callId:'a',startedAt:1000},'b',false,5000);assert.equal(s.startedAt,null);s=nextCallClock(s,null,false,6000);assert.deepEqual(s,{callId:null,startedAt:null});});
test('formats durations and preserves time during SDK/rejoin recovery',()=>{assert.equal(formatCallDuration(65),'01:05');assert.equal(formatCallDuration(3601),'1:00:01');assert.equal(formatCallDuration(-4),'00:00');assert.equal(callPrimaryStatus('active','rejoining',true,'03:21'),'다시 연결 중 · 03:21');});
test('a video session does not authorize camera capture without explicit confirmation',()=>{assert.equal(cameraAllowed('video',false),false);assert.equal(cameraAllowed('audio',true),false);assert.equal(cameraAllowed('video',true),true);});
test('drag positions remain reachable after window size changes',()=>{assert.deepEqual(clampCallPosition(1000,-10,300,500,100,150),{x:200,y:0});assert.deepEqual(clampCallPosition(100,100,50,50,100,150),{x:0,y:0});});
test('terminal outcomes have distinct explanations',()=>{assert.notEqual(callEndLabel('failed'),callEndLabel('ended'));assert.notEqual(callEndLabel('declined'),callEndLabel('missed'));assert.notEqual(callEndLabel('cancelled'),callEndLabel('ended'));});

import {callPeerId} from './callPresentation.ts';
test('retry from a caller selects the other database participant',()=>{assert.equal(callPeerId({callerId:'db-A',calleeId:'db-B'},'db-A'),'db-B');});
test('retry from a callee selects the original caller',()=>{assert.equal(callPeerId({callerId:'db-A',calleeId:'db-B'},'db-B'),'db-A');});
test('auth-provider IDs or an unresolved backend owner cannot retry to an arbitrary participant',()=>{assert.equal(callPeerId({callerId:'db-A',calleeId:'db-B'},'user_clerk_A'),'');assert.equal(callPeerId({callerId:'db-A',calleeId:'db-B'}),'');});
