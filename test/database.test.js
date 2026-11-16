const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
test('schema runs twice, denies browser writes and protects private state', async()=>{
 const db=new PGlite();
 try {
  await db.exec('create role anon; create role authenticated; create publication supabase_realtime;');
  const sql=fs.readFileSync(require.resolve('../sql/setup.sql'),'utf8');
  await db.exec(sql);await db.exec(sql);
  await db.exec("begin; update royal_spin.game set state='{\"round\":2}' where id=1; rollback;");
  assert.deepEqual((await db.query('select state from royal_spin.game')).rows[0].state,{});
  await db.exec('set role anon');
  assert.equal((await db.query('select revision from public.royal_spin_revision')).rows.length,1);
  await assert.rejects(db.query('select * from royal_spin.game'),/permission denied/);
  await assert.rejects(db.query('update public.royal_spin_revision set revision=9'),/permission denied/);
 } finally {await db.close();}
});
