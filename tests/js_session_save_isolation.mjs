/**
 * Adversarial auth/save race regression using the real api.js and queue.
 * A's pending HTTP and queued writes must never be rebound to B or update B.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createProgressSaveQueue} from '../public/progress-save-queue.js';

const values = new Map();
globalThis.localStorage = {
  getItem:key=>values.get(key)??null,
  setItem:(key,val)=>values.set(key,String(val)),
  removeItem:key=>values.delete(key),
};
const {
  api, setToken, clearToken, getAuthSnapshot, isAuthSnapshotCurrent,
} = await import('../public/api.js');

function deferred() {
  let resolve, reject;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
  return {promise,resolve,reject};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

let calls=[];
let hangA=null;
globalThis.fetch = async (path, options={}) => {
  const token = options.headers?.get('Authorization')??'';
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({path,token,body});
  if (token === 'Bearer user-A' && body?.checkpoint === 'A-first') {
    await hangA.promise;
  }
  return {ok:true,status:200,json:async()=>({
    progress:{
      chapterId:'ch1',revision:body?.expectedRevision+1,
      state:structuredClone(body?.state)
    }
  })};
};

const saved=new Map();
const queue=createProgressSaveQueue({
  getSession:getAuthSnapshot,isCurrentSession:isAuthSnapshotCurrent,
  getProgress:id=>saved.get(id),setProgress:(id,record)=>saved.set(id,record),
  sendProgress:(id,body,authToken)=>api('PUT',`/api/progress/${id}`,body,{authToken}),
  copy:structuredClone,
});

setToken('user-A');
saved.set('ch1',{revision:0,state:{owner:'A-old'}});
hangA=deferred();
const first=queue.save('ch1',{owner:'A',sequence:1},'A-first');
const second=queue.save('ch1',{owner:'A',sequence:2},'A-second');
await tick();
assert.equal(calls.length,1,'Second A request is queued behind its first');

clearToken();
queue.invalidatePending();
saved.clear();
setToken('user-B');
saved.set('ch1',{revision:0,state:{owner:'B-original'}});
const third=queue.save('ch1',{owner:'B',sequence:1},'B-first');
await third;
assert.equal(calls.length,2,'B does not wait for obsolete A network request');
assert.equal(calls[1].token,'Bearer user-B');
assert.equal(saved.get('ch1').state.owner,'B');
hangA.resolve();
const outcomes=await Promise.allSettled([first,second]);
assert.ok(outcomes.every(x=>x.status==='rejected' && x.reason.code==='SESSION_CHANGED'));
assert.equal(calls.length,2,'A queued write never sends with B credentials');
assert.equal(saved.get('ch1').state.owner,'B','A response must not overwrite B cache');
assert.equal(saved.get('ch1').revision,1);

// Even without an explicit queue reset, setToken bumps a generation. This
// prevents stale A saves being revived when switching A -> B -> A quickly.
const waiting=deferred();
calls=[];
hangA=waiting;
setToken('user-A');
saved.set('ch1',{revision:1,state:{owner:'A'}});
const old=queue.save('ch1',{owner:'A',stale:true},'A-first');
await tick();
const oldQueued=queue.save('ch1',{owner:'A',stale:true},'A-second');
setToken('user-B');
setToken('user-A');
queue.invalidatePending();
waiting.resolve();
const oldResults=await Promise.allSettled([old,oldQueued]);
assert.ok(oldResults.every(x=>x.status==='rejected' && x.reason.code==='SESSION_CHANGED'));
assert.equal(saved.get('ch1').state.stale,undefined);

// Capture a GET token at call time; a later response is invalidated.
const pendingGET=deferred();
globalThis.fetch = async (path,options={}) => {
  if(path==='/api/progress') await pendingGET.promise;
  return {ok:true,status:200,json:async()=>({progress:[{owner:'A'}]})};
};
const oldGet=api('GET','/api/progress');
await tick();
setToken('user-B');
pendingGET.resolve();
const getOutcome=await Promise.allSettled([oldGet]);
assert.equal(getOutcome[0].status,'rejected');
assert.equal(getOutcome[0].reason.code,'SESSION_CHANGED');

// A callback created under A but invoked only after B login still carries A's
// original owner snapshot; it must fail before sending any HTTP request.
setToken('user-A');
const roomOwnerA=getAuthSnapshot();
setToken('user-B');
await assert.rejects(
  queue.save('ch1',{owner:'old-room-A'},'late_room_callback',roomOwnerA),
  error=>error.code==='SESSION_CHANGED'
);

// Check the *actual* logout implementation: local invalidation must occur
// synchronously, before a slow server logout completes; old token is supplied
// explicitly and a new B login is not revoked by A's delayed response.
const appSource=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const begin=appSource.indexOf('async function logout()');
const end=appSource.indexOf('function managementContext()',begin);
assert.ok(begin>=0 && end>begin);
const logoutGate=deferred();
let logoutToken=null;
globalThis.fetch=async(path, options={})=>{
  if(path==='/api/auth/logout') {
    logoutToken=options.headers.get('Authorization');
    await logoutGate.promise;
  }
  return {ok:true,status:200,json:async()=>({})};
};
setToken('logout-A');
let landing=0;
const sandbox={
  getAuthSnapshot,clearToken,progressQueue:queue,api,
  me:{role:'student'},chapters:[{id:'ch1'}],characters:{hai:{}},
  gameProfile:{balance:99},saved:new Map([['ch1',{state:{owner:'logout-A'}}]]),
  showLanding:()=>landing++,
};
vm.runInNewContext(appSource.slice(begin,end)+'\nglobalThis.logout=logout;',sandbox);
const inFlightLogout=sandbox.logout();
assert.equal(getAuthSnapshot().token,'','Token must clear immediately, not after await');
assert.equal(sandbox.me,null);
assert.equal(sandbox.saved.size,0);
assert.equal(landing,1);
assert.equal(logoutToken,'Bearer logout-A');
setToken('logout-B');
logoutGate.resolve();
await inFlightLogout;
assert.equal(getAuthSnapshot().token,'logout-B',
  'Late logout(A) response must not sign out B');

console.log('Auth/save race PASS: A pending and queued writes never borrow B token, stale A replies never pollute B, A→B→A and delayed GET isolated.');
