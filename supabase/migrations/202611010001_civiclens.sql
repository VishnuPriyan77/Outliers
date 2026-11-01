-- Chennai buildathon: fictional officers, simulated department assignments.
create extension if not exists pgcrypto;
create table public.officials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null, department text not null check(department in ('roads','water','waste','lighting','review'))
);
create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null default ('CL-' || to_char(now(),'YYYY') || '-' || upper(substr(gen_random_uuid()::text,1,8))),
  citizen_id uuid not null references auth.users(id),
  draft jsonb not null,
  department text not null check(department in ('roads','water','waste','lighting','review')),
  status text not null default 'submitted' check(status in ('submitted','acknowledged','in_progress','resolved','closed','appealed')),
  appealed boolean not null default false,
  created_at timestamptz not null default now(), due_at timestamptz not null
);
create table public.evidence (
  id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id),
  uploader_id uuid not null references auth.users(id), name text not null, path text unique not null,
  mime text not null check(mime in ('image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','video/mp4')),
  size integer not null check(size between 1 and 4194304), sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  purpose text not null check(purpose in ('report','resolution')), duplicate boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.events (
  id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id),
  actor_id uuid not null references auth.users(id), actor text not null, action text not null, note text not null, created_at timestamptz not null default now()
);
create table public.ai_usage (user_id uuid not null references auth.users(id), day date not null default current_date, requests integer not null default 0, primary key(user_id,day));
create index complaints_owner on public.complaints(citizen_id);
create index complaints_department on public.complaints(department,status);
create index evidence_complaint on public.evidence(complaint_id);
create index events_complaint on public.events(complaint_id,created_at);
create index evidence_hash on public.evidence(sha256);

alter table public.officials enable row level security;
alter table public.complaints enable row level security;
alter table public.evidence enable row level security;
alter table public.events enable row level security;
alter table public.ai_usage enable row level security;

create function public.can_access(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.complaints c where c.id=p_id and (c.citizen_id=auth.uid() or exists(select 1 from public.officials o where o.user_id=auth.uid() and o.department=c.department)));
$$;
create function public.can_upload(p_id uuid,p_actor uuid,p_purpose text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.complaints c where c.id=p_id and (
 (p_purpose='report' and c.citizen_id=p_actor and c.status in ('submitted','acknowledged','in_progress','appealed')) or
 (p_purpose='resolution' and c.status='in_progress' and exists(select 1 from public.officials o where o.user_id=p_actor and o.department=c.department))
 ));
$$;
create policy own_official on public.officials for select to authenticated using(user_id=auth.uid());
create policy complaint_read on public.complaints for select to authenticated using(public.can_access(id));
create policy evidence_read on public.evidence for select to authenticated using(public.can_access(complaint_id));
create policy event_read on public.events for select to authenticated using(public.can_access(complaint_id));
-- No client insert/update/delete policies. All mutations use narrowly-scoped functions.
revoke all on public.officials,public.complaints,public.evidence,public.events,public.ai_usage from anon,authenticated;
grant select on public.officials,public.complaints,public.evidence,public.events to authenticated;

create function public.submit_complaint(p_draft jsonb) returns uuid language plpgsql security definer set search_path='' as $$
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
 insert into public.complaints(citizen_id,draft,department,due_at) values(auth.uid(),p_draft,v_dept,now()+case when (p_draft->>'urgent')::boolean then interval '1 day' else interval '21 days' end) returning id into v_id;
 insert into public.events(complaint_id,actor_id,actor,action,note) values(v_id,auth.uid(),'citizen','submitted','Citizen confirmed report. Routed through the simulated directory.');
 return v_id;
end; $$;

create function public.transition_complaint(p_id uuid,p_status text,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare c public.complaints; officer boolean; citizen boolean;
begin
 select * into c from public.complaints where id=p_id for update;
 if c.id is null or auth.uid() is null then raise exception 'Complaint unavailable'; end if;
 officer:=exists(select 1 from public.officials where user_id=auth.uid() and department=c.department);
 citizen:=c.citizen_id=auth.uid();
 if length(trim(coalesce(p_note,''))) not between 5 and 2000 then raise exception 'An update of 5–2000 characters is required'; end if;
 if not (
 (officer and ((c.status='submitted' and p_status='acknowledged') or (c.status in ('acknowledged','appealed') and p_status='in_progress') or (c.status='in_progress' and p_status='resolved'))) or
 (citizen and c.status='resolved' and (p_status='closed' or (p_status='appealed' and not c.appealed)))
 ) then raise exception 'Status change not permitted'; end if;
 if p_status='resolved' and not exists(select 1 from public.evidence where complaint_id=p_id and purpose='resolution' and created_at >= (select max(created_at) from public.events where complaint_id=p_id and action='in_progress')) then raise exception 'Resolution evidence required'; end if;
 update public.complaints set status=p_status,appealed=appealed or p_status='appealed' where id=p_id;
 insert into public.events(complaint_id,actor_id,actor,action,note) values(p_id,auth.uid(),case when p_status in ('closed','appealed') then 'citizen' else (select display_name from public.officials where user_id=auth.uid()) end,p_status,trim(p_note));
end; $$;

create function public.reassign_complaint(p_id uuid,p_department text,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare c public.complaints;
begin
 select * into c from public.complaints where id=p_id for update;
 if auth.uid() is null or not exists(select 1 from public.officials where user_id=auth.uid() and department=c.department) or c.status in ('resolved','closed') then raise exception 'Assignment denied'; end if;
 if coalesce(p_department,'') not in ('roads','water','waste','lighting','review') or p_department=c.department or length(trim(coalesce(p_note,''))) not between 5 and 2000 then raise exception 'Valid new department and reason required'; end if;
 update public.complaints set department=p_department where id=p_id;
 insert into public.events(complaint_id,actor_id,actor,action,note) values(p_id,auth.uid(),(select display_name from public.officials where user_id=auth.uid()),'reassigned',c.department||' → '||p_department||': '||trim(p_note));
end; $$;

-- Trusted server finalizes metadata. Clients cannot forge a checked file hash.
create function public.attach_evidence(p_actor uuid,p_complaint uuid,p_path text,p_name text,p_mime text,p_size integer,p_sha256 text,p_purpose text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_duplicate boolean;
begin
 perform 1 from public.complaints where id=p_complaint for update;
 if not public.can_upload(p_complaint,p_actor,p_purpose) or split_part(p_path,'/',1)<>p_actor::text or split_part(p_path,'/',2)<>p_complaint::text then raise exception 'Evidence access denied'; end if;
 if (select count(*) from public.evidence where complaint_id=p_complaint)>=10 then raise exception 'Ten attachments maximum per complaint'; end if;
 if not exists(select 1 from storage.objects where bucket_id='evidence' and name=p_path) then raise exception 'Stored file missing'; end if;
 -- Scope duplicate disclosure to this complaint, avoiding information leaks across citizens.
 v_duplicate:=exists(select 1 from public.evidence where complaint_id=p_complaint and sha256=p_sha256);
 insert into public.evidence(complaint_id,uploader_id,path,name,mime,size,sha256,purpose,duplicate) values(p_complaint,p_actor,p_path,left(p_name,200),p_mime,p_size,p_sha256,p_purpose,v_duplicate) returning id into v_id;
 insert into public.events(complaint_id,actor_id,actor,action,note) values(p_complaint,p_actor,case when p_purpose='resolution' then (select display_name from public.officials where user_id=p_actor) else 'citizen' end,'evidence_added',p_purpose||' evidence received; SHA-256 recorded. Authenticity unverified.');
 return v_id;
end; $$;

create function public.consume_ai_quota() returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if auth.uid() is null then return false; end if;
 insert into public.ai_usage(user_id,day,requests) values(auth.uid(),current_date,1)
 on conflict(user_id,day) do update set requests=public.ai_usage.requests+1 where public.ai_usage.requests<30 returning requests into n;
 return n is not null;
end; $$;

revoke execute on function public.can_access(uuid),public.can_upload(uuid,uuid,text),public.submit_complaint(jsonb),public.transition_complaint(uuid,text,text),public.reassign_complaint(uuid,text,text),public.attach_evidence(uuid,uuid,text,text,text,integer,text,text),public.consume_ai_quota() from public,anon,authenticated;
grant execute on function public.can_access(uuid),public.can_upload(uuid,uuid,text),public.submit_complaint(jsonb),public.transition_complaint(uuid,text,text),public.reassign_complaint(uuid,text,text),public.consume_ai_quota() to authenticated;
grant execute on function public.attach_evidence(uuid,uuid,text,text,text,integer,text,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('evidence','evidence',false,4194304,array['image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','video/mp4']) on conflict(id) do nothing;
create policy evidence_upload on storage.objects for insert to authenticated with check(
 bucket_id='evidence' and (storage.foldername(name))[1]=auth.uid()::text and
 (public.can_upload(((storage.foldername(name))[2])::uuid,auth.uid(),'report') or public.can_upload(((storage.foldername(name))[2])::uuid,auth.uid(),'resolution'))
);
create policy evidence_download on storage.objects for select to authenticated using(bucket_id='evidence' and exists(select 1 from public.evidence e where e.path=storage.objects.name and public.can_access(e.complaint_id)));
create policy unregistered_upload_cleanup on storage.objects for delete to authenticated using(bucket_id='evidence' and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.evidence e where e.path=storage.objects.name));
