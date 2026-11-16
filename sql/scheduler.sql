-- Optional: enable pg_cron and pg_net in Supabase Database > Extensions first.
-- Store these two secrets in Supabase Vault before running this script:
-- royal_spin_tick_url = https://YOUR-DOMAIN/api/tick
-- royal_spin_cron_secret = the same CRON_SECRET configured on Vercel
-- The scheduler invokes the server, which advances due phases under a row lock.
-- HTTP latency may delay a transition; stored deadlines are authoritative.
select cron.schedule('royal-spin-tick', '5 seconds', $$
 select net.http_post(
   url := (select decrypted_secret from vault.decrypted_secrets where name='royal_spin_tick_url'),
   headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
     'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='royal_spin_cron_secret')),
   body := '{}'::jsonb,
   timeout_milliseconds := 4000
 );
$$);
-- Disable later with: select cron.unschedule('royal-spin-tick');
