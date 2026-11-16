'use strict';
const { Pool } = require('pg');
let pool;
function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (Supabase transaction pooler).');
  return pool ||= new Pool({ connectionString: process.env.DATABASE_URL, max: 3,
    connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000,
    ssl: process.env.NODE_ENV === 'test' ? false : { rejectUnauthorized: true } });
}
async function transaction(work) {
  const client = await database().connect();
  try {
    await client.query('begin');
    await client.query("set local lock_timeout = '10s'");
    await client.query("set local statement_timeout = '15s'");
    const { rows: [row] } = await client.query('select state from royal_spin.game where id=1 for update');
    if (!row) throw new Error('Run sql/setup.sql first.');
    row.findRequest = async (id, requestId) => {
      const { rows } = await client.query('select result from royal_spin.requests where session_id=$1 and request_id=$2', [id, requestId]);
      return rows[0]?.result;
    };
    row.saveRequest = (id, requestId, result) => client.query('insert into royal_spin.requests(session_id, request_id, result) values ($1, $2, $3)', [id, requestId, result]);
    const previous = JSON.stringify(row.state);
    const result = await work(row);
    if (previous !== JSON.stringify(row.state)) {
      await client.query('update royal_spin.game set state=$1 where id=1', [row.state]);
      await client.query('update public.royal_spin_revision set revision=revision+1 where id=1');
    }
    await client.query('commit');
    return result;
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}
module.exports = { transaction };
