-- Run Pricefloor background jobs from Supabase instead of Vercel Cron.
--
-- Before these jobs can authenticate, create a Vault secret whose value
-- matches CRON_SECRET in the app's production environment:
--
--   select vault.create_secret('YOUR_CRON_SECRET', 'pricefloor_cron_secret');
--
-- The secret is looked up at execution time and is never stored in cron.job.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Make the migration safe to re-run or supersede an older schedule.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in (
      'pricefloor-sla-reminders',
      'pricefloor-expired-quotes'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end
$$;

select cron.schedule(
  'pricefloor-sla-reminders',
  '0 * * * *',
  $job$
    select net.http_get(
      url := 'https://pricefloor.vysyzdev.com/api/cron/pricefloor-sla-reminders',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || coalesce(
          (select decrypted_secret
           from vault.decrypted_secrets
           where name = 'pricefloor_cron_secret'
           limit 1),
          ''
        )
      ),
      timeout_milliseconds := 30000
    );
  $job$
);

select cron.schedule(
  'pricefloor-expired-quotes',
  '15 * * * *',
  $job$
    select net.http_get(
      url := 'https://pricefloor.vysyzdev.com/api/cron/pricefloor-expired-quotes',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || coalesce(
          (select decrypted_secret
           from vault.decrypted_secrets
           where name = 'pricefloor_cron_secret'
           limit 1),
          ''
        )
      ),
      timeout_milliseconds := 30000
    );
  $job$
);
