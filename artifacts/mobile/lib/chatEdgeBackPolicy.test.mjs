import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldCaptureChatEdgeBack as capture, shouldCompleteChatEdgeBack as complete } from './chatEdgeBackPolicy.ts';
test('vertical history scrolling and bubble reply gestures stay outside edge navigation',()=>{
 assert.equal(capture({x0:12,dx:20,dy:40}),false);
 assert.equal(capture({x0:80,dx:100,dy:0}),false);
 assert.equal(capture({x0:12,dx:-40,dy:0}),false);
 assert.equal(capture({x0:12,dx:40,dy:5}),true);
});
test('a small drag cancels while deliberate distance or velocity completes navigation',()=>{
 assert.equal(complete({dx:20,vx:1},400),false);
 assert.equal(complete({dx:100,vx:0.1},400),false);
 assert.equal(complete({dx:140,vx:0.1},400),true);
 assert.equal(complete({dx:60,vx:0.9},400),true);
});
