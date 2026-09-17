import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE);
const db = new PGlite();
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(await readFile(new URL('../supabase/migrations/20260917130128_browser_budget_ledger.sql', import.meta.url), 'utf8'));
  const reserve = (id, cost = 100000) => db.query('select public.assistant_reserve_browser($1,$2)', [id, cost]);
  const a = '00000000-0000-4000-8000-000000000001';
  const b = '00000000-0000-4000-8000-000000000002';
  await assert.rejects(reserve(a), /not configured/);
  await db.exec("insert into public.assistant_browser_budget(period_start,period_end) values(now()-interval '1 day',now()+interval '1 day')");
  await assert.rejects(reserve(a), /disabled/);
  await db.exec('update public.assistant_browser_budget set enabled=true');
  await reserve(a);
  await assert.rejects(reserve(a));
  await assert.rejects(reserve(b));
  let usage = (await db.query('select browser_seconds,ai_micro_usd from public.assistant_browser_budget')).rows[0];
  assert.equal(Number(usage.browser_seconds), 300);
  assert.equal(Number(usage.ai_micro_usd), 100000);
  await db.exec("update public.assistant_browser_reservations set state='uncertain'");
  await assert.rejects(reserve(b));
  await db.exec("update public.assistant_browser_reservations set state='closed'");
  await db.exec('update public.assistant_browser_budget set ai_micro_usd=10000000');
  await assert.rejects(reserve(b), /exhausted/);
  await db.exec('update public.assistant_browser_budget set ai_micro_usd=0,browser_seconds=324000');
  await assert.rejects(reserve(b), /exhausted/);
  await db.exec("update public.assistant_browser_budget set browser_seconds=0,period_end=now()+interval '4 minutes'");
  await assert.rejects(reserve(b), /reconciliation/);
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(reserve(b), /permission denied/);
    await assert.rejects(db.query('select * from public.assistant_browser_budget'), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec("update public.assistant_browser_budget set period_end=now()+interval '1 day'; set role service_role");
  await reserve(b, 0);
  await db.exec("reset role; update public.assistant_browser_reservations set session_id='verified-session',state='running' where request_id='00000000-0000-4000-8000-000000000002'; set role service_role");
  const wrong = await db.query("update public.assistant_browser_reservations set state='closed' where request_id=$1 and session_id=$2 and state in ('running','uncertain') returning request_id", [b, 'wrong-session']);
  assert.equal(wrong.rows.length, 0);
  const closed = await db.query("update public.assistant_browser_reservations set state='closed' where request_id=$1 and session_id=$2 and state in ('running','uncertain') returning request_id", [b, 'verified-session']);
  assert.equal(closed.rows.length, 1);
  usage = (await db.query('select browser_seconds from public.assistant_browser_budget')).rows[0];
  assert.equal(Number(usage.browser_seconds), 300);
  // Competing requests: one may reserve, the other must fail without consuming budget.
  const attempts = await Promise.allSettled([
    reserve('00000000-0000-4000-8000-000000000003', 0),
    reserve('00000000-0000-4000-8000-000000000004', 0),
  ]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  usage = (await db.query('select browser_seconds from public.assistant_browser_budget')).rows[0];
  assert.equal(Number(usage.browser_seconds), 600);
  console.log('PASS: missing/disabled budget, duplicate and active lock, ambiguous lock, rollback, AI/browser caps, expiry, role isolation, server reservation');
} finally { await db.close(); }
