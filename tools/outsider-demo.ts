// Shows, through the real API, what an outsider (Taylor) gets compared with a
// group member (Sam) for "Saturday morning loop". The tests prove the same;
// this is the human-readable version for the recording and for reviewers.
//
//   npm run outsider-demo

import { createClient } from "@supabase/supabase-js";

const API_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SATURDAY = "c3000000-0000-4000-8000-000000000001";

async function as(persona: string) {
  const db = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await db.auth.signInWithPassword({
    email: `${persona}@example.test`,
    password: "altair-fixture-pass",
  });
  if (error) throw error;
  return { db, token: data.session!.access_token };
}

const show = (label: string, value: unknown) =>
  console.log(`  ${label.padEnd(34)} ${JSON.stringify(value)}`);

async function report(persona: string) {
  const { db, token } = await as(persona);
  console.log(`\n=== ${persona} ===`);

  const meetup = await db
    .from("meetup_details")
    .select("title,status,meeting_point_name,meeting_point_lat,area_radius_m")
    .eq("id", SATURDAY);
  show("meetup_details (Saturday loop):", meetup.data ?? meetup.error?.message);

  const attendees = await db.from("meetup_attendees").select("display_name").eq("meetup_id", SATURDAY);
  show("meetup_attendees:", attendees.data ?? attendees.error?.message);

  const point = await db.from("meetup_meeting_points").select("name,lat,lng").eq("meetup_id", SATURDAY);
  show("meetup_meeting_points (exact):", point.data ?? point.error?.message);

  const home = await db.from("users").select("display_name,home_lat").limit(1);
  show("users.home_lat:", home.error ? `denied: ${home.error.message}` : home.data);

  const direct = await db.from("rsvps").insert({ meetup_id: SATURDAY, user_id: "a1000000-0000-4000-8000-000000000007" });
  show("direct insert into rsvps:", direct.error ? `denied: ${direct.error.message}` : "ALLOWED (bug!)");

  const res = await fetch(`${API_URL}/functions/v1/meetups/${SATURDAY}/rsvp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
  });
  show("RSVP via endpoint:", `${res.status} ${await res.text()}`);
  // Leave the seed as it was.
  await fetch(`${API_URL}/functions/v1/meetups/${SATURDAY}/rsvp`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
  });
}

await report("taylor");
await report("sam");
