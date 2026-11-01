-- Additive routing upgrade. Apply only after remote preflight and migration-history inspection.
-- Initial migration is intentionally unchanged. Transaction prevents partial upgrades.
begin;
do $$ begin
 if to_regclass('public.complaints') is null or to_regclass('public.officials') is null
 or to_regprocedure('public.submit_complaint(jsonb)') is null then
   raise exception 'Initial CivicLens schema missing: inspect state before applying the initial migration';
 end if;
end $$;
alter table public.officials drop constraint officials_department_check;
alter table public.officials add constraint officials_department_check check(department in ('roads','water','waste','lighting','electricity','stormwater','review'));
alter table public.complaints drop constraint complaints_department_check;
alter table public.complaints add constraint complaints_department_check check(department in ('roads','water','waste','lighting','electricity','stormwater','review'));
alter table public.complaints add column routing jsonb;

-- Mirrors lib/domain.ts; cross-layer regression tests guard parity.
create function public.classification_signal(p_text text) returns jsonb language plpgsql immutable set search_path='' as $$
declare t text:=normalize(coalesce(p_text,''),NFC); electrical boolean; light_cable boolean; hazard boolean; found text[]:='{}'; c text;
begin
 electrical:=t ~* 'electric(al|ity)?|power\s*(line|cable|wire|supply|cut|outage)|live\s*wire|transformer|\y(tneb|tangedco|tnpdcl|eb)\y|மின்(சார|கம்பி| கம்பி| விநியோக|தடை)|மின்கம்ப|மின்சாரம்|மின்மாற்றி|min\s*kambi|current\s*(wire|kambi|cut)';
 light_cable:=t ~* 'street\s*light.{0,12}(cable|wire)|(cable|wire).{0,12}(street\s*light)|தெரு\s*விளக்.{0,15}(கம்பி|கேபிள்)' and t ~* 'wire|cable|(power|transmission|electric)\s*line|கம்பி|கேபிள்|kambi' and not (t ~* 'power\s*line|distribution|transformer|மின்\s*விநியோக');
 hazard:=(t ~* 'wire|cable|(power|transmission|electric)\s*line|கம்பி|கேபிள்|kambi' and t ~* 'cut|snapp|broken|fallen|\ydown\y|downed|dangl|hanging|exposed|spark|sever|leak|அறுந்த|துண்டி|வெட்ட|விழுந்|விழுந்த|தொங்க|வெளியே|தீப்பொறி|arunth|arundh') or t ~* 'electrocut|live\s*wire|மின்சாரம் தாக்க|மின்.{0,20}தீப்பொறி';
 if t ~* '\y(not sure|unsure|maybe|hypothetical|what if|no (cut|fallen|live|broken)|not (cut|broken|damaged)|transmission|high[ -]voltage|telecom|broadband|internet|fibre|fiber)\y|தெரியவில்லை|உறுதியாக|தொலைத்தொடர்பு|உயர்\s*அழுத்த|அறுந்து?\s*இல்லை' then return jsonb_build_object('category','other','hazard',hazard); end if;
 if t ~* '\y(transmission|high[ -]voltage|telecom|broadband|internet|fibre|fiber|private wiring|internal wiring|inside (house|home|flat))\y|தொலைத்தொடர்பு|உயர்\s*அழுத்த|தனியார்\s*மின்' then return jsonb_build_object('category','other','hazard',hazard); end if;
 if electrical and hazard and not light_cable then return jsonb_build_object('category','electricity','hazard',true); end if;
 if t ~* 'pothole|road\s*(is\s*)?(damage|broken|crack|collapsed)|damaged\s*road|bridge\s*(damage|broken|collapse)|சாலை.{0,20}(குழி|சேத|உடை)|பாலம்.{0,20}(சேத|உடை)' then found:=array_append(found,'road'); end if;
 if t ~* 'sewag|sewer|drinking\s*water|water\s*(supply|leak|pipe)|pipe\s*(burst|broken|leak)|குடிநீர்|கழிவுநீர்|தண்ணீர்|குழாய்' then found:=array_append(found,'water'); end if;
 if t ~* 'garbage|rubbish|trash|waste|குப்பை' then found:=array_append(found,'waste'); end if;
 if t ~* 'street\s*light|lamp\s*(post|not|broken)|தெரு\s*விளக்கு|தெருவிளக்கு' then found:=array_append(found,'lighting'); end if;
 if t ~* 'storm\s*water|rain\s*water\s*drain|மழைநீர்\s*வடிகால்' then found:=array_append(found,'stormwater'); end if;
 if electrical and not light_cable and not (t ~* 'street\s*light|lamp\s*(post|not|broken)|தெரு\s*விளக்கு|தெருவிளக்கு') then found:=array_append(found,'electricity'); end if;
 c:=case when cardinality(found)=1 and not(hazard and not electrical and not light_cable) then found[1] else 'other' end;
 return jsonb_build_object('category',c,'hazard',hazard);
end; $$;

create function public.routing_version() returns text language sql immutable set search_path='' as $$ select '202611010002'::text $$;
create function public.routing_decision(p_draft jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare signal jsonb:=public.classification_signal(coalesce(p_draft->>'description','')||' '||coalesce(p_draft->>'impact',''));
 c text:=p_draft->>'category'; dept text:='review'; reason text:='Category or asset ownership needs human verification.';
 reason_ta text:='வகை அல்லது சொத்தின் பொறுப்பை மனிதர் சரிபார்க்க வேண்டும்.';
 directory jsonb:='{"roads": {"parent": "Municipal Administration and Water Supply", "source": "https://chennaicorporation.gov.in/gcc/department/road/", "scope": "Citizen-reported municipal road; asset ownership needs verification."}, "water": {"parent": "Municipal Administration and Water Supply", "source": "https://cmwssb.tn.gov.in/", "scope": "CMWSSB water supply and sewerage; not stormwater drains."}, "waste": {"parent": "Municipal Administration and Water Supply", "source": "https://chennaicorporation.gov.in/gcc/department/solid-waste-management/", "scope": "GCC municipal solid waste collection."}, "lighting": {"parent": "Municipal Administration and Water Supply", "source": "https://chennaicorporation.gov.in/gcc/department/electrical/", "scope": "GCC streetlights and their electrical assets; not distribution lines."}, "electricity": {"parent": "Energy", "source": "https://www.tnpdcl.org/en/tnpdcl/about-us/tnpdcl-profile/", "scope": "TNPDCL distribution network. Local section/circle must verify the asset; private or transmission assets need triage."}, "stormwater": {"parent": "Municipal Administration and Water Supply", "source": "https://chennaicorporation.gov.in/gcc/department/storm-water/", "scope": "GCC stormwater drains; not CMWSSB sewers or Water Resources rivers."}, "review": {"parent": "CivicLens (simulation)", "source": "https://www.tn.gov.in/document_dept_list.php?cate_name=YWxs", "scope": "Human verification of category, ownership and competent authority required."}}'::jsonb;
begin
 if not (p_draft->>'chennai')::boolean then reason:='Outside the Chennai pilot; local authority must be verified.'; reason_ta:='சென்னை சோதனை எல்லைக்கு வெளியே; உள்ளூர் அதிகாரியைச் சரிபார்க்க வேண்டும்.';
 elsif p_draft->>'assetOwner'='private' then reason:='Private asset: public agency ownership cannot be assumed.'; reason_ta:='தனியார் சொத்து: அரசு நிறுவனத்தின் பொறுப்பு என்று கருத முடியாது.';
 elsif (coalesce(p_draft->>'description','')||' '||coalesce(p_draft->>'impact','')) ~* '\y(transmission|high[ -]voltage|telecom|broadband|internet|fibre|fiber|private wiring|internal wiring|inside (house|home|flat))\y|தொலைத்தொடர்பு|உயர்\s*அழுத்த|தனியார்\s*மின்' then reason:='Asset type is outside the verified service directory; human ownership verification required.'; reason_ta:='இந்தச் சொத்து சரிபார்க்கப்பட்ட சேவை அடைவுக்கு வெளியே உள்ளது; பொறுப்பை மனிதர் சரிபார்க்க வேண்டும்.';
 elsif (signal->>'hazard')::boolean and signal->>'category'<>c and c<>'other' then reason:='Safety signal conflicts with the chosen category. Confirm the electrical asset or request human triage.'; reason_ta:='ஆபத்து அறிகுறியும் தேர்ந்தெடுத்த வகையும் முரண்படுகின்றன. மின் சொத்தை உறுதிசெய்யவும் அல்லது மனிதப் பரிசீலனை கோரவும்.';
 elsif c<>'other' and not(c='road' and p_draft->>'ownership'<>'municipal') then
   dept:=case c when 'road' then 'roads' else c end;
   reason:=directory->dept->>'scope';
   reason_ta:='உறுதிசெய்த சேவை வகை மற்றும் சென்னை இடத்தின் அடிப்படையில். உள்ளூர் சொத்தின் பொறுப்பை அதிகாரி சரிபார்க்க வேண்டும்.';
 end if;
 return jsonb_build_object('version','202611010002','department',dept,'reason',reason,'reasonTa',reason_ta,
 'severity',case when (signal->>'hazard')::boolean then 'hazard' when (p_draft->>'urgent')::boolean or (coalesce(p_draft->>'description','')||' '||coalesce(p_draft->>'impact','')) ~* 'electrocut|fire|injur|immediate danger|மின்சாரம் தாக்க|தீ விபத்து|காயம்' then 'priority' else 'routine' end,
 'humanReview',dept='review','source',directory->dept->>'source','parent',directory->dept->>'parent');
end; $$;

create or replace function public.submit_complaint(p_draft jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_dept text; decision jsonb; v_category text:=p_draft->>'category';
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if (select count(*) from public.complaints where citizen_id=auth.uid() and created_at>now()-interval '1 day')>=20 then raise exception 'Daily report limit reached'; end if;
 if jsonb_typeof(p_draft)<>'object' or
    length(coalesce(p_draft->>'description','')) not between 10 and 3000 or
    length(coalesce(p_draft->>'location','')) not between 5 and 500 or
    length(coalesce(p_draft->>'duration','')) not between 1 and 200 or
    length(coalesce(p_draft->>'impact','')) not between 3 and 1000 or
    coalesce(v_category,'') not in ('road','water','waste','lighting','electricity','stormwater','other') or
    coalesce(p_draft->>'language','') not in ('en','ta') or
    coalesce(p_draft->>'ownership','') not in ('municipal','unknown') or
    coalesce(jsonb_typeof(p_draft->'chennai'),'')<>'boolean' or
    coalesce(jsonb_typeof(p_draft->'urgent'),'')<>'boolean' or
    coalesce(p_draft->>'assetOwner','unknown') not in ('unknown','public','private') or
    p_draft->'consent' is distinct from 'true'::jsonb
 then raise exception 'Invalid or unconfirmed report'; end if;
 p_draft:=(p_draft-'routing'-'department') || jsonb_build_object('assetOwner',coalesce(p_draft->>'assetOwner','unknown'));
 decision:=public.routing_decision(p_draft);
 v_dept:=decision->>'department';
 -- A client/model cannot downgrade a detected hazard by unchecking urgent.
 if decision->>'severity'<>'routine' then p_draft:=jsonb_set(p_draft,'{urgent}','true'::jsonb); end if;
 insert into public.complaints(citizen_id,draft,department,routing,due_at)
 values(auth.uid(),p_draft,v_dept,decision,now()+case when (p_draft->>'urgent')::boolean then interval '1 day' else interval '21 days' end) returning id into v_id;
 insert into public.events(complaint_id,actor_id,actor,action,note) values(v_id,auth.uid(),'citizen','submitted','Citizen confirmed. Simulated routing 202611010002: '||v_dept||'. '||(decision->>'reason'));
 return v_id;
end; $$;

create or replace function public.reassign_complaint(p_id uuid,p_department text,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare c public.complaints;
begin
 select * into c from public.complaints where id=p_id for update;
 if auth.uid() is null or not exists(select 1 from public.officials where user_id=auth.uid() and department=c.department) or c.status in ('resolved','closed') then raise exception 'Assignment denied'; end if;
 if coalesce(p_department,'') not in ('roads','water','waste','lighting','electricity','stormwater','review') or p_department=c.department or length(trim(coalesce(p_note,''))) not between 5 and 2000 then raise exception 'Valid new department and reason required'; end if;
 update public.complaints set department=p_department where id=p_id;
 insert into public.events(complaint_id,actor_id,actor,action,note) values(p_id,auth.uid(),(select display_name from public.officials where user_id=auth.uid()),'reassigned',c.department||' → '||p_department||': '||trim(p_note));
end; $$;


revoke execute on function public.classification_signal(text),public.routing_decision(jsonb),public.routing_version() from public,anon,authenticated;
grant execute on function public.routing_version() to authenticated;
commit;
