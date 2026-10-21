import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scannerLoadPercent} from '../src/scanner-load-progress.ts';
test('shows real byte progress and leaves unknown native opening indeterminate',()=>{
 assert.equal(scannerLoadPercent({stage:'downloading',completedBytes:25,totalBytes:100}),25);
 assert.equal(scannerLoadPercent({stage:'opening',completedBytes:0,totalBytes:0}),null);
 assert.equal(scannerLoadPercent({stage:'downloading',completedBytes:150,totalBytes:100}),100);
 assert.equal(scannerLoadPercent({stage:'downloading',completedBytes:NaN,totalBytes:100}),null);
});
