import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE);
const db = new PGlite();
try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
 create table public.profiles(id uuid primary key); create table public.messages(id uuid primary key,owner_id uuid);`);
 for (const file of ['20260917011906_executive_assistant_v1.sql','20260917132616_browser_approval_claims.sql'])
   await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
 const owner='10000000-0000-4000-8000-000000000001', message='10000000-0000-4000-8000-000000000002';
 await db.query('insert into profiles values($1)',[owner]);
 await db.query('insert into messages values($1,$2)',[message,owner]);
 const task=(await db.query("insert into assistant_tasks(owner_id,message_id,kind,plan) values($1,$2,'website','{}') returning id",[owner,message])).rows[0].id;
 await db.query("update assistant_tasks set status='ready' where id=$1",[task]);
 const payload={id:'10000000-0000-4000-8000-000000000003',ownerId:owner,taskId:task,revision:2,mode:'read_only',status:'approved',targetUrl:'https://example.com/',approvedUrls:['https://example.com/'],approvedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()};
 await db.query('insert into assistant_browser_approvals(id,owner_id,task_id,payload) values($1,$2,$3,$4)',[payload.id,owner,task,payload]);
 const claim=async p=>(await db.query('select assistant_claim_browser_approval($1) as ok',[p])).rows[0].ok;
 for (const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`);
  await assert.rejects(claim(payload),/permission denied/);
  await assert.rejects(db.query('select * from assistant_browser_approvals'),/permission denied/);
  await db.exec('reset role');
 }
 await db.exec('set role service_role');
 assert.equal(await claim({...payload,targetUrl:'https://changed.example/'}),false);
 assert.equal(await claim({...payload,revision:3}),false);
 const expired={...payload,expiresAt:new Date(Date.now()-1000).toISOString()};
 await db.query('update assistant_browser_approvals set payload=$1',[expired]);
 assert.equal(await claim(expired),false);
 await db.query('update assistant_browser_approvals set payload=$1',[payload]);
 const results=await Promise.all([claim(payload),claim(payload)]);
 assert.equal(results.filter(Boolean).length,1);
 assert.equal(await claim(payload),false);
 const state=(await db.query('select status,revision from assistant_tasks where id=$1',[task])).rows[0];
 assert.equal(state.status,'executing'); assert.equal(state.revision,3);
 const save=async revision=>db.query("update assistant_tasks set status='waiting',result=$1 where id=$2 and owner_id=$3 and kind='website' and status='executing' and revision=$4 returning id",[{status:'read',text:'Synthetic result',cleanup:'confirmed',externalSubmissionPerformed:false},task,owner,revision]);
 assert.equal((await save(2)).rows.length,0);
 assert.equal((await save(3)).rows.length,1);
 assert.equal((await save(3)).rows.length,0);
 await db.exec('reset role');
 assert.equal((await db.query('select count(*)::int as n from assistant_task_events')).rows[0].n,4);
 const secondMessage='10000000-0000-4000-8000-000000000004';
 await db.query('insert into messages values($1,$2)',[secondMessage,owner]);
 const second=(await db.query("insert into assistant_tasks(owner_id,message_id,kind,plan) values($1,$2,'website',$3) returning id",[owner,secondMessage,{evidence:{analysis:{actionSuggestion:{targetUrl:'https://example.com/review'}}}}])).rows[0].id;
 const prepare=async(revision,url='https://example.com/review',user=owner)=>(await db.query('select assistant_prepare_browser_approval($1,$2,$3,$4) as payload',[user,second,revision,url])).rows[0].payload;
 for (const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`); await assert.rejects(prepare(1),/permission denied/); await db.exec('reset role');
 }
 await db.exec('set role service_role');
 await assert.rejects(prepare(1,'https://changed.example/'));
 await assert.rejects(prepare(1,undefined,'10000000-0000-4000-8000-000000000099'));
 const firstApproval=await prepare(1);
 assert.equal(firstApproval.revision,2);
 assert.deepEqual(firstApproval.approvedUrls,['https://example.com/review']);
 await assert.rejects(prepare(1));
 const latestApproval=await prepare(2);
 assert.equal(await claim(firstApproval),false);
 assert.equal(await claim(latestApproval),true);
 await assert.rejects(prepare(4));
 console.log('PASS: role isolation, exact payload, revision, database expiry, single claim, task transition and audit. PGlite serializes concurrent calls; not a multiprocess test.');
} finally { await db.close(); }
