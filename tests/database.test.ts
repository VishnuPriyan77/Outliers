import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
let db: PGlite;
const citizen = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  roads = "33333333-3333-4333-8333-333333333333",
  water = "44444444-4444-4444-8444-444444444444";
let id: string;
const draft = {
  description: "Large pothole near school entrance",
  location: "Velachery, Chennai",
  duration: "Two weeks",
  impact: "Pedestrians and vehicles affected",
  category: "road",
  language: "en",
  chennai: true,
  ownership: "municipal",
  urgent: false,
  consent: true,
};
async function as(uid: string, role = "authenticated") {
  await db.exec(
    `reset role; set role ${role}; select set_config('request.jwt.claim.sub','${uid}',false)`,
  );
}
async function change(status: string) {
  await db.query("select public.transition_complaint($1,$2,$3)", [
    id,
    status,
    "Meaningful test update",
  ]);
}
async function rejects(sql: string, params: unknown[] = []) {
  await expect(db.query(sql, params)).rejects.toThrow();
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;
 create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
 insert into auth.users values('${citizen}'),('${other}'),('${roads}'),('${water}');
 `);
  await db.exec(
    readFileSync(
      "supabase/migrations/202611010001_civiclens.sql",
      "utf8",
    ).replace("create extension if not exists pgcrypto;", ""),
  );
  await db.exec(
    readFileSync("supabase/migrations/202611010002_severity.sql", "utf8"),
  );
  await db.query("insert into public.officials values($1,$2,$3),($4,$5,$6)", [
    roads,
    "Demo roads officer",
    "roads",
    water,
    "Demo water officer",
    "water",
  ]);
}, 30000);
afterAll(async () => {
  await db?.close();
});
it("rejects anonymous submission and routes confirmed complaints in SQL", async () => {
  await as("", "anon");
  await rejects("select public.submit_complaint($1)", [draft]);
  await as(citizen);
  await rejects("select public.submit_complaint($1)", [
    { ...draft, consent: false },
  ]);
  const result = await db.query<{ id: string }>(
    "select public.submit_complaint($1) as id",
    [draft],
  );
  id = result.rows[0].id;
  const rows = await db.query<{ department: string; status: string }>(
    "select department,status from public.complaints",
  );
  expect(rows.rows).toEqual([{ department: "roads", status: "submitted" }]);
});
it("isolates citizens and departments; prevents self-promotion, tampering and forged proof", async () => {
  await as(other);
  expect((await db.query("select * from public.complaints")).rows).toHaveLength(
    0,
  );
  expect((await db.query("select * from public.events")).rows).toHaveLength(0);
  await rejects("insert into public.officials values($1,$2,$3)", [
    other,
    "Intruder",
    "roads",
  ]);
  await rejects("update public.complaints set status=$1 where id=$2", [
    "closed",
    id,
  ]);
  await rejects("select public.transition_complaint($1,$2,$3)", [
    id,
    "closed",
    "Close another citizen report",
  ]);
  await as(water);
  expect((await db.query("select * from public.complaints")).rows).toHaveLength(
    0,
  );
  await rejects("select public.transition_complaint($1,$2,$3)", [
    id,
    "acknowledged",
    "Wrong department cannot act",
  ]);
  await as(citizen);
  await rejects("delete from public.events");
  await rejects("update public.events set note=$1", ["tampered"]);
  await rejects("select public.attach_evidence($1,$2,$3,$4,$5,$6,$7,$8)", [
    citizen,
    id,
    `${citizen}/${id}/bad`,
    "bad.jpg",
    "image/jpeg",
    3,
    "a".repeat(64),
    "report",
  ]);
});
it("enforces lifecycle, resolution proof, private storage and one appeal transactionally", async () => {
  await as(roads);
  await rejects("select public.transition_complaint($1,$2,$3)", [
    id,
    "resolved",
    "Cannot skip steps",
  ]);
  await change("acknowledged");
  await change("in_progress");
  await expect(change("resolved")).rejects.toThrow(/evidence/i);
  const path = `${roads}/${id}/test-image`;
  await db.query("insert into storage.objects(bucket_id,name) values($1,$2)", [
    "evidence",
    path,
  ]);
  await as(roads, "service_role");
  await db.query("select public.attach_evidence($1,$2,$3,$4,$5,$6,$7,$8)", [
    roads,
    id,
    path,
    "repair.jpg",
    "image/jpeg",
    4,
    "b".repeat(64),
    "resolution",
  ]);
  await as(other);
  expect((await db.query("select * from storage.objects")).rows).toHaveLength(
    0,
  );
  await rejects("insert into storage.objects(bucket_id,name) values($1,$2)", [
    "evidence",
    `${other}/${id}/forbidden`,
  ]);
  await as(roads);
  await change("resolved");
  await as(citizen);
  expect((await db.query("select * from storage.objects")).rows).toHaveLength(
    1,
  );
  await db.query("delete from storage.objects");
  expect((await db.query("select * from storage.objects")).rows).toHaveLength(
    1,
  );
  await change("appealed");
  await as(roads);
  await change("in_progress");
  await expect(change("resolved")).rejects.toThrow(/evidence/i);
  const freshPath = `${roads}/${id}/second-image`;
  await db.query("insert into storage.objects(bucket_id,name) values($1,$2)", [
    "evidence",
    freshPath,
  ]);
  await as(roads, "service_role");
  await db.query("select public.attach_evidence($1,$2,$3,$4,$5,$6,$7,$8)", [
    roads,
    id,
    freshPath,
    "second.jpg",
    "image/jpeg",
    4,
    "c".repeat(64),
    "resolution",
  ]);
  await as(roads);
  await change("resolved");
  await as(citizen);
  await expect(change("appealed")).rejects.toThrow(/not permitted/);
  await change("closed");
  expect(
    (
      await db.query<{ status: string; appealed: boolean }>(
        "select status,appealed from public.complaints",
      )
    ).rows[0],
  ).toEqual({ status: "closed", appealed: true });
  expect((await db.query("select * from public.events")).rows).toHaveLength(10);
});
it("routes unsupported locations and road ownership uncertainty to human triage", async () => {
  await as(citizen);
  await db.query("select public.submit_complaint($1)", [
    { ...draft, ownership: "unknown" },
  ]);
  await db.query("select public.submit_complaint($1)", [
    { ...draft, chennai: false, category: "water" },
  ]);
  expect(
    (
      await db.query(
        "select * from public.complaints where department='review'",
      )
    ).rows,
  ).toHaveLength(2);
});
it("permits only 30 AI calls per account per day", async () => {
  await as(citizen);
  for (let i = 0; i < 30; i++)
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select public.consume_ai_quota() as allowed",
        )
      ).rows[0].allowed,
    ).toBe(true);
  expect(
    (
      await db.query<{ allowed: boolean }>(
        "select public.consume_ai_quota() as allowed",
      )
    ).rows[0].allowed,
  ).toBe(false);
});

it("queues assessments without response-day targets and preserves assessment RLS", async () => {
  await as(other);
  const { rows } = await db.query<{ id: string }>(
    "select public.submit_complaint($1) as id",
    [{ ...draft, ai_image_consent: false }],
  );
  const severityId = rows[0].id;
  expect(
    (
      await db.query<{ due_at: null }>(
        "select due_at from public.complaints where id=$1",
        [severityId],
      )
    ).rows[0].due_at,
  ).toBeNull();
  expect(
    (
      await db.query(
        "select * from public.severity_assessments where complaint_id=$1",
        [severityId],
      )
    ).rows,
  ).toHaveLength(1);
  await rejects(
    "update public.severity_assessments set status='completed' where complaint_id=$1",
    [severityId],
  );
  await rejects("select public.claim_severity($1,$2)", [severityId, other]);
  await as(citizen);
  expect(
    (
      await db.query(
        "select * from public.severity_assessments where complaint_id=$1",
        [severityId],
      )
    ).rows,
  ).toHaveLength(0);
  await as(water);
  expect(
    (
      await db.query(
        "select * from public.severity_assessments where complaint_id=$1",
        [severityId],
      )
    ).rows,
  ).toHaveLength(0);
  await as(roads);
  expect(
    (
      await db.query(
        "select * from public.severity_assessments where complaint_id=$1",
        [severityId],
      )
    ).rows,
  ).toHaveLength(1);
});
it("validates consent and coordinates in SQL even for direct RPC callers", async () => {
  await as(other);
  for (const extra of [
    { ai_image_consent: "true" },
    { context_consent: 1 },
    { context_coordinates: { latitude: 91, longitude: 80 } },
    { context_coordinates: { latitude: "13", longitude: 80 } },
  ]) {
    await rejects("select public.submit_complaint($1)", [
      { ...draft, ...extra },
    ]);
  }
});
it("claims jobs once, enforces leases, persists results and limits retries", async () => {
  await as(other);
  const { rows } = await db.query<{ id: string }>(
    "select public.submit_complaint($1) as id",
    [draft],
  );
  const severityId = rows[0].id;
  await as(other, "service_role");
  const claim = async (actor = other) =>
    (
      await db.query<{ job: { lease: string } | null }>(
        "select public.claim_severity($1,$2) as job",
        [severityId, actor],
      )
    ).rows[0].job;
  expect(await claim(water)).toBeNull();
  const first = await claim();
  expect(first?.lease).toBeTruthy();
  expect(await claim()).toBeNull();
  expect(
    (
      await db.query<{ ok: boolean }>(
        "select public.finish_severity($1,$2,$3,$4) as ok",
        [severityId, citizen, null, "failed"],
      )
    ).rows[0].ok,
  ).toBe(false);
  await db.query("select public.finish_severity($1,$2,$3,$4)", [
    severityId,
    first!.lease,
    null,
    "Provider unavailable",
  ]);
  expect(await claim()).toBeNull(); // cooldown
  for (let i = 0; i < 2; i++) {
    await db.exec(
      "reset role; update public.severity_assessments set updated_at=now()-interval '3 minutes' where complaint_id='" +
        severityId +
        "'",
    );
    await as(other, "service_role");
    const job = await claim();
    expect(job?.lease).toBeTruthy();
    await db.query("select public.finish_severity($1,$2,$3,$4)", [
      severityId,
      job!.lease,
      null,
      "Provider unavailable",
    ]);
  }
  await db.exec(
    "reset role; update public.severity_assessments set updated_at=now()-interval '3 minutes' where complaint_id='" +
      severityId +
      "'",
  );
  await as(other, "service_role");
  expect(await claim()).toBeNull(); // three attempts total
});
it("counts distinct nearby citizens and never exposes their reports", async () => {
  const located = {
    ...draft,
    context_consent: true,
    context_coordinates: { latitude: 13.001, longitude: 80.001 },
  };
  await as(roads);
  await db.query("select public.submit_complaint($1)", [located]);
  await db.query("select public.submit_complaint($1)", [located]);
  await as(other);
  const { rows } = await db.query<{ id: string }>(
    "select public.submit_complaint($1) as id",
    [located],
  );
  await as(other, "service_role");
  const job = (
    await db.query<{ job: { corroboration: number; lease: string } }>(
      "select public.claim_severity($1,$2) as job",
      [rows[0].id, other],
    )
  ).rows[0].job;
  expect(job.corroboration).toBe(1);
  await db.query("select public.finish_severity($1,$2,$3,$4)", [
    rows[0].id,
    job.lease,
    { score: null, coverage: 10 },
    null,
  ]);
  await as(other);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from public.severity_assessments where complaint_id=$1",
        [rows[0].id],
      )
    ).rows[0].status,
  ).toBe("partial");
});
it("globally rate limits Nominatim and prevents client access to its gate", async () => {
  await as(other);
  await rejects("select public.severity_nominatim_slot()");
  await as(other, "service_role");
  expect(
    (
      await db.query<{ ok: boolean }>(
        "select public.severity_nominatim_slot() as ok",
      )
    ).rows[0].ok,
  ).toBe(true);
  expect(
    (
      await db.query<{ ok: boolean }>(
        "select public.severity_nominatim_slot() as ok",
      )
    ).rows[0].ok,
  ).toBe(false);
});
it("recovers stale leases and invalidates in-flight results when report evidence changes", async () => {
  await as(other);
  const { rows } = await db.query<{ id: string }>(
    "select public.submit_complaint($1) as id",
    [draft],
  );
  const severityId = rows[0].id;
  await as(other, "service_role");
  const claim = async () =>
    (
      await db.query<{ job: { lease: string } }>(
        "select public.claim_severity($1,$2) as job",
        [severityId, other],
      )
    ).rows[0].job;
  const first = await claim();
  await db.exec(
    "reset role; update public.severity_assessments set updated_at=now()-interval '3 minutes' where complaint_id='" +
      severityId +
      "'",
  );
  await as(other, "service_role");
  const recovered = await claim();
  expect(recovered.lease).not.toBe(first.lease);
  expect(
    (
      await db.query<{ ok: boolean }>(
        "select public.finish_severity($1,$2,$3,$4) as ok",
        [severityId, first.lease, null, "old"],
      )
    ).rows[0].ok,
  ).toBe(false);
  await as(other);
  const path = `${other}/${severityId}/fresh-report`;
  await db.query(
    "insert into storage.objects(bucket_id,name) values('evidence',$1)",
    [path],
  );
  await as(other, "service_role");
  await db.query("select public.attach_evidence($1,$2,$3,$4,$5,$6,$7,$8)", [
    other,
    severityId,
    path,
    "hazard.jpg",
    "image/jpeg",
    4,
    "c".repeat(64),
    "report",
  ]);
  expect(
    (
      await db.query<{ ok: boolean }>(
        "select public.finish_severity($1,$2,$3,$4) as ok",
        [severityId, recovered.lease, { score: 90 }, null],
      )
    ).rows[0].ok,
  ).toBe(false);
  expect(
    (
      await db.query<{ status: string; attempts: number }>(
        "select status,attempts from public.severity_assessments where complaint_id=$1",
        [severityId],
      )
    ).rows[0],
  ).toEqual({ status: "pending", attempts: 0 });
});
it("marks a crashed final attempt failed instead of leaving it processing forever", async () => {
  await as(other);
  const { rows } = await db.query<{ id: string }>(
    "select public.submit_complaint($1) as id",
    [draft],
  );
  await db.exec("reset role");
  await db.query(
    "update public.severity_assessments set status='processing',attempts=3,lease=gen_random_uuid(),updated_at=now()-interval '3 minutes' where complaint_id=$1",
    [rows[0].id],
  );
  await as(other, "service_role");
  expect(
    (
      await db.query<{ job: null }>(
        "select public.claim_severity($1,$2) as job",
        [rows[0].id, other],
      )
    ).rows[0].job,
  ).toBeNull();
  expect(
    (
      await db.query<{ status: string; lease: null }>(
        "select status,lease from public.severity_assessments where complaint_id=$1",
        [rows[0].id],
      )
    ).rows[0],
  ).toEqual({ status: "failed", lease: null });
});
