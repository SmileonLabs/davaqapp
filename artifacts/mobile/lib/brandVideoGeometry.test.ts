import test from "node:test";import assert from "node:assert/strict";import {videoPoint} from "./brandVideoGeometry.ts";
test("wide video points ignore letterboxing",()=>{assert.equal(videoPoint(150,10,300,300,1600,900),null);assert.deepEqual(videoPoint(150,150,300,300,1600,900),{x:0.5,y:0.5});});
test("portrait video points handle contain fitting and invalid metadata",()=>{assert.equal(videoPoint(10,150,300,300,900,1600),null);assert.deepEqual(videoPoint(150,150,300,300,900,1600),{x:0.5,y:0.5});assert.equal(videoPoint(0,0,0,0,0,0),null);});
