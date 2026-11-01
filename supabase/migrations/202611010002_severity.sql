-- Additive assessment storage. Existing complaint/evidence/event policies are unchanged.
-- Retain historical due_at for compatibility, but stop assigning response-day targets.
alter table public.complaints alter column due_at drop not null;
create or replace function public.submit_complaint(p_draft jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_dept text; v_category text:=p_draft->>'category';
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if (select count(*) from public.complaints where citizen_id=auth.uid() and created_at>now()-interval '1 day')>=20 then raise exception 'Daily report limit reached'; end if;
 if jsonb_typeof(p_draft)<>'object' or
    length(coalesce(p_draft->>'description','')) not between 10 and 3000 or
    length(coalesce(p_draft->>'location','')) not between 5 and 500 or
    length(coalesce(p_draft->>'duration','')) not between 1 and 200 or
    length(coalesce(p_draft->>'impact','')) not between 3 and 1000 or
    coalesce(v_category,'') not in ('road','water','waste','lighting','other') or
    coalesce(p_draft->>'language','') not in ('en','ta') or
    coalesce(p_draft->>'ownership','') not in ('municipal','unknown') or
    coalesce(jsonb_typeof(p_draft->'chennai'),'')<>'boolean' or
    coalesce(jsonb_typeof(p_draft->'urgent'),'')<>'boolean' or
    p_draft->'consent' is distinct from 'true'::jsonb
 then raise exception 'Invalid or unconfirmed report'; end if;
 v_dept:=case when not (p_draft->>'chennai')::boolean or v_category='other' or (v_category='road' and p_draft->>'ownership'<>'municipal') then 'review'
 when v_category='road' then 'roads' when v_category='water' then 'water' when v_category='waste' then 'waste' else 'lighting' end;
 insert into public.complaints(citizen_id,draft,department) values(auth.uid(),p_draft,v_dept) returning id into v_id;
 insert into public.events(complaint_id,actor_id,actor,action,note) values(v_id,auth.uid(),'citizen','submitted','Citizen confirmed report. Routed through the simulated directory.');
 return v_id;
end; $$;


create table public.severity_assessments (
 complaint_id uuid primary key references public.complaints(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','processing','completed','partial','failed')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 lease uuid, result jsonb, error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(error is null or length(error)<=200),
 check(result is null or jsonb_typeof(result)='object')
);
alter table public.severity_assessments enable row level security;
create policy assessment_read on public.severity_assessments for select to authenticated using(public.can_access(complaint_id));
revoke all on public.severity_assessments from public,anon,authenticated;
grant select on public.severity_assessments to authenticated;
grant select on public.severity_assessments,public.complaints,public.evidence to service_role;

create function public.queue_severity() returns trigger language plpgsql security definer set search_path='' as $$
declare coords jsonb := new.draft->'context_coordinates';
begin
 if (new.draft ? 'ai_image_consent' and jsonb_typeof(new.draft->'ai_image_consent')<>'boolean') or
    (new.draft ? 'context_consent' and jsonb_typeof(new.draft->'context_consent')<>'boolean') then raise exception 'Invalid assessment consent'; end if;
 if coords is not null then
  if jsonb_typeof(coords)<>'object' or jsonb_typeof(coords->'latitude') is distinct from 'number' or jsonb_typeof(coords->'longitude') is distinct from 'number' then raise exception 'Invalid coordinates'; end if;
  if (coords->>'latitude')::numeric not between -90 and 90 or (coords->>'longitude')::numeric not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
 end if;
 insert into public.severity_assessments(complaint_id) values(new.id);
 return new;
end; $$;
create trigger complaint_severity after insert on public.complaints for each row execute function public.queue_severity();
-- Do not assess historical reports without a deliberate request; no consent is inferred.

create function public.claim_severity(p_id uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.complaints; a public.severity_assessments; v_lease uuid; n integer; corroboration integer := null;
begin
 select * into c from public.complaints where id=p_id for update;
 if c.id is null then return null; end if;
 if p_actor is not null and p_actor<>c.citizen_id and not exists(select 1 from public.officials where user_id=p_actor and department=c.department) then return null; end if;
 insert into public.severity_assessments(complaint_id) values(p_id) on conflict do nothing;
 select * into a from public.severity_assessments where complaint_id=p_id for update;
 if a.attempts>=3 then
  if a.status='processing' and a.updated_at<=now()-interval '2 minutes' then
   update public.severity_assessments set status='failed',lease=null,error='Assessment attempts exhausted; manual review required.',updated_at=now() where complaint_id=p_id;
  end if;
  return null;
 end if;
 if a.status='completed' or
 (a.status='processing' and a.updated_at>now()-interval '2 minutes') or
 (a.status in ('failed','partial') and a.updated_at>now()-interval '30 seconds') then return null; end if;
 insert into public.ai_usage(user_id,day,requests) values(c.citizen_id,current_date,1)
 on conflict(user_id,day) do update set requests=public.ai_usage.requests+1 where public.ai_usage.requests<30 returning requests into n;
 if n is null then
  update public.severity_assessments set status='failed', error='Daily AI quota reached; retry later.',updated_at=now() where complaint_id=p_id;
  return null;
 end if;
 -- Corroboration uses distinct OTHER citizens with matching category, coordinates and recent reports.
 -- It never transmits identities or other reports to the provider or requesting citizen.
 if c.draft->'context_consent'='true'::jsonb and c.draft ? 'context_coordinates' then
  select count(distinct x.citizen_id) into corroboration from public.complaints x
  where x.id<>c.id and x.citizen_id<>c.citizen_id and x.created_at>now()-interval '30 days'
   and x.draft->>'category'=c.draft->>'category' and x.draft->'context_consent'='true'::jsonb
   and jsonb_typeof(x.draft->'context_coordinates'->'latitude')='number'
   and jsonb_typeof(x.draft->'context_coordinates'->'longitude')='number'
   and power(((x.draft->'context_coordinates'->>'latitude')::numeric-(c.draft->'context_coordinates'->>'latitude')::numeric)*111320,2)
      +power(((x.draft->'context_coordinates'->>'longitude')::numeric-(c.draft->'context_coordinates'->>'longitude')::numeric)*111320*cos(radians((c.draft->'context_coordinates'->>'latitude')::double precision)),2)<=40000;
 end if;
 v_lease:=gen_random_uuid();
 update public.severity_assessments set status='processing',attempts=attempts+1,lease=v_lease,error=null,updated_at=now() where complaint_id=p_id;
 return jsonb_build_object('id',c.id,'draft',c.draft,'lease',v_lease,'corroboration',corroboration);
end; $$;
create function public.finish_severity(p_id uuid,p_lease uuid,p_result jsonb,p_error text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.severity_assessments set
 status=case when p_error is not null or p_result is null then 'failed' when p_result->'score'='null'::jsonb then 'partial' else 'completed' end,
 result=p_result,error=left(p_error,200),lease=null,updated_at=now()
 where complaint_id=p_id and lease=p_lease and status='processing';
 return found;
end; $$;
revoke execute on function public.queue_severity(),public.claim_severity(uuid,uuid),public.finish_severity(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_severity(uuid,uuid),public.finish_severity(uuid,uuid,jsonb,text) to service_role;
create index severity_pending on public.severity_assessments(status,updated_at) where status in ('pending','processing','failed');

-- A fresh report image invalidates any in-flight lease, so old workers cannot overwrite new input.
create function public.refresh_severity_evidence() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.purpose='report' then
  insert into public.severity_assessments(complaint_id) values(new.complaint_id)
  on conflict(complaint_id) do update set status='pending',attempts=0,lease=null,result=null,error=null,updated_at=now();
 end if;
 return new;
end; $$;
create trigger severity_evidence after insert on public.evidence for each row execute function public.refresh_severity_evidence();
revoke execute on function public.refresh_severity_evidence() from public,anon,authenticated;
-- Global Nominatim public endpoint limit across concurrent serverless invocations.
create table public.severity_context_gate (id boolean primary key default true check(id), last_request timestamptz not null);
insert into public.severity_context_gate values(true,'1970-01-01');
alter table public.severity_context_gate enable row level security;
revoke all on public.severity_context_gate from public,anon,authenticated;
create function public.severity_nominatim_slot() returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.severity_context_gate set last_request=clock_timestamp() where id and last_request<clock_timestamp()-interval '1 second';
 return found;
end; $$;
revoke execute on function public.severity_nominatim_slot() from public,anon,authenticated;
grant execute on function public.severity_nominatim_slot() to service_role;
