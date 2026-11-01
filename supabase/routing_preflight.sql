-- READ ONLY. Run in the hosted SQL editor before choosing any migration.
-- No citizen data or credentials are selected.
select to_regclass('public.complaints') as complaints,
       to_regclass('public.officials') as officials,
       to_regprocedure('public.submit_complaint(jsonb)') as submit_rpc,
       to_regprocedure('public.routing_version()') as routing_version_rpc;
select table_name,column_name,data_type from information_schema.columns
where table_schema='public' and table_name in ('complaints','officials')
order by table_name,ordinal_position;
select conrelid::regclass as relation,conname,pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid in (to_regclass('public.complaints'),to_regclass('public.officials'));
select n.nspname,p.proname,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('submit_complaint','reassign_complaint','routing_version','classification_signal','routing_decision');
select schemaname,tablename,policyname,roles,cmd from pg_policies
where schemaname='public' and tablename in ('complaints','officials','evidence','events');
select to_regclass('supabase_migrations.schema_migrations') as migration_history;
-- If migration_history exists, separately inspect:
-- select version,name from supabase_migrations.schema_migrations order by version;
-- If routing_version_rpc exists, separately run: select public.routing_version();
-- Missing history does not prove missing schema: initial setup may have been run in SQL Editor.
