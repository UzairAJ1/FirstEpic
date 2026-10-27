import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Meetup, MEETUP_COLUMNS } from "@altair/contracts";
import pg from "pg";
import { ANON_KEY, API_URL, DB_URL, FUNCTIONS_URL } from "./env.ts";
import { PASSWORD, spare, users, type Persona } from "./fixtures.ts";

// ---------------------------------------------------------------------
// Every response body any test receives is recorded here, so leak-scan.ts
// can check that no home location ever left the server.
// ---------------------------------------------------------------------
export const recordedBodies: string[] = [];

const recordingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  recordedBodies.push(await res.clone().text());
  return res;
};

// ---------------------------------------------------------------------
// Signed-in personas: a real session from Supabase Auth, as the app has.
// ---------------------------------------------------------------------
export type Session = { persona: Persona; db: SupabaseClient; token: string; userId: string };

const sessions = new Map<Persona, Session>();

export async function signIn(persona: Persona): Promise<Session> {
  const cached = sessions.get(persona);
  if (cached) return cached;

  const db = createClient(API_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: recordingFetch },
  });
  const { data, error } = await db.auth.signInWithPassword({
    email: users[persona].email,
    password: PASSWORD,
  });
  if (error || !data.session) throw new Error(`sign-in failed for ${persona}: ${error?.message}`);

  const session = { persona, db, token: data.session.access_token, userId: data.user.id };
  sessions.set(persona, session);
  return session;
}

export function anonClient(): SupabaseClient {
  return createClient(API_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: recordingFetch },
  });
}

// ---------------------------------------------------------------------
// The write endpoint
// ---------------------------------------------------------------------
export type ApiResult = { status: number; body: any };

export async function api(
  session: Session | null,
  method: "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<ApiResult> {
  const headers: Record<string, string> = { apikey: ANON_KEY, "Content-Type": "application/json" };
  if (session) headers.Authorization = `Bearer ${session.token}`;
  const res = await recordingFetch(`${FUNCTIONS_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

export const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

export function meetupBody(groupId: string, overrides: Record<string, unknown> = {}) {
  return {
    groupId,
    title: "Test walk",
    startsAt: inDays(3),
    meetingPoint: { ...spare },
    ...overrides,
  };
}

/** Create a meetup through the endpoint and return its id. */
export async function createMeetup(session: Session, groupId: string): Promise<string> {
  const res = await api(session, "POST", "", meetupBody(groupId));
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

// ---------------------------------------------------------------------
// Reads, exactly as the app does them: the view under RLS, parsed with
// the shared contract.
// ---------------------------------------------------------------------
export async function readMeetups(session: Session, filter?: { id?: string; groupId?: string }) {
  let q = session.db.from("meetup_details").select(MEETUP_COLUMNS).order("starts_at");
  if (filter?.id) q = q.eq("id", filter.id);
  if (filter?.groupId) q = q.eq("group_id", filter.groupId);
  const { data, error } = await q;
  if (error) throw new Error(`read failed: ${error.message}`);
  return data.map((row) => Meetup.parse(row));
}

export async function readMeetup(session: Session, id: string) {
  const [m] = await readMeetups(session, { id });
  return m;
}

// ---------------------------------------------------------------------
// Database owner connection, for setup the API can't do (a started
// meetup) and for checking stored state. Never used to make assertions
// about what a user can see.
// ---------------------------------------------------------------------
let pool: pg.Pool | undefined;

export async function asOwner<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
  pool ??= new pg.Pool({ connectionString: DB_URL, max: 2 });
  return (await pool.query<T>(sql, params)).rows;
}

export async function closeOwner() {
  await pool?.end();
  pool = undefined;
}

/** Distance in meters between two coordinates (haversine). */
export function metersBetween(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
