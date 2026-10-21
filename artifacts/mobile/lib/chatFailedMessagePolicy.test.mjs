import test from 'node:test';
import assert from 'node:assert/strict';
import {canDiscardFailedMessage} from './chatFailedMessagePolicy.ts';
const failed={id:'temp-m-photo',clientMessageId:'m-photo',senderId:'owner',_deliveryState:'failed'};
test('orphaned failed photo can be removed even when its outbox entry is gone',()=>assert.equal(canDiscardFailedMessage(failed,'m-photo','owner'),true));
test('confirmed, pending and other-account photos are preserved',()=>{
 for(const override of [{id:'server-id'},{_deliveryState:'pending'},{senderId:'recipient'},{clientMessageId:'another-operation'}]) assert.equal(canDiscardFailedMessage({...failed,...override},'m-photo','owner'),false);
});
