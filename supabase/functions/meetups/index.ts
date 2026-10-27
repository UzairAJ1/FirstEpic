// The write endpoints for meetups. Every write in the slice goes through here:
//
//   POST   /meetups                 create a meetup
//   POST   /meetups/:id/cancel      cancel (creator only)
//   POST   /meetups/:id/rsvp        RSVP (idempotent)
//   DELETE /meetups/:id/rsvp        withdraw an RSVP (idempotent)
//
// For each request: verify the caller's JWT and take their id from it,
// validate input with the shared Zod contract, then call the matching
// Postgres write function as service_role. Those functions are not callable
// by app users directly, so this is the only write path.

import { createClient } from "@supabase/supabase-js";
import {
  CancelMeetupResponse,
  CreateMeetupInput,
  CreateMeetupResponse,
  MeetupIdParams,
  RsvpResponse,
} from "../../../packages/contracts/src/index.ts";
import { errorResponse, fromDb, HttpError, json, parse, readJson } from "./http.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// The only source of the acting user's id. Asks Supabase Auth to validate
// the token, so expired or signed-out sessions are rejected too.
async function requireUserId(req: Request): Promise<string> {
  const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError(401, "unauthorized", "Sign in required");

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "unauthorized", "Sign in required");
  return data.user.id;
}

async function createMeetup(userId: string, body: unknown): Promise<Response> {
  const input = parse(CreateMeetupInput, body);
  const { data, error } = await admin.rpc("create_meetup", {
    p_user_id: userId,
    p_group_id: input.groupId,
    p_title: input.title,
    p_starts_at: input.startsAt,
    p_place_name: input.meetingPoint.name,
    p_lat: input.meetingPoint.lat,
    p_lng: input.meetingPoint.lng,
  });
  if (error) throw fromDb(error);
  return json(201, CreateMeetupResponse.parse({ id: data }));
}

async function cancelMeetup(userId: string, meetupId: string): Promise<Response> {
  const { error } = await admin.rpc("cancel_meetup", { p_user_id: userId, p_meetup_id: meetupId });
  if (error) throw fromDb(error);
  return json(200, CancelMeetupResponse.parse({ id: meetupId, status: "cancelled" }));
}

async function setRsvp(userId: string, meetupId: string, attending: boolean): Promise<Response> {
  const { error } = await admin.rpc(attending ? "rsvp" : "withdraw_rsvp", {
    p_user_id: userId,
    p_meetup_id: meetupId,
  });
  if (error) throw fromDb(error);
  return json(200, RsvpResponse.parse({ meetupId, attending }));
}

Deno.serve(async (req) => {
  try {
    // Path arrives as /meetups/... ; keep what follows the function name.
    const segments = new URL(req.url).pathname.split("/").filter(Boolean);
    const route = segments.slice(segments.indexOf("meetups") + 1);

    const userId = await requireUserId(req);

    if (route.length === 0 && req.method === "POST") {
      return await createMeetup(userId, await readJson(req));
    }

    if (route.length === 2) {
      const { meetupId } = parse(MeetupIdParams, { meetupId: route[0] });
      const action = `${req.method} ${route[1]}`;
      if (action === "POST cancel") return await cancelMeetup(userId, meetupId);
      if (action === "POST rsvp") return await setRsvp(userId, meetupId, true);
      if (action === "DELETE rsvp") return await setRsvp(userId, meetupId, false);
    }

    throw new HttpError(404, "not_found", "No such endpoint");
  } catch (err) {
    return errorResponse(err);
  }
});
