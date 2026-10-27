// The one shared contract for the meetups slice.
//
// Imported by the Edge Function (Deno, via a relative import and an import
// map for "zod") and by the React Native app (Metro, via the npm workspace).
// Keep this a single dependency-free file apart from zod: Deno needs explicit
// .ts extensions on relative imports, which this file avoids by having none.

import { z } from "zod";

// ---------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------
export const Id = z.uuid();

export const Latitude = z.number().min(-90).max(90);
export const Longitude = z.number().min(-180).max(180);

// ISO 8601 with an explicit offset, e.g. 2026-11-01T08:00:00.000Z or +02:00.
export const Timestamp = z.iso.datetime({ offset: true });

// ---------------------------------------------------------------------
// Write inputs (validated on the server; the app reuses them for forms).
// Strict: unknown keys such as createdBy or userId are rejected, not
// silently dropped. Who is acting always comes from the verified JWT.
// ---------------------------------------------------------------------
export const MeetingPointInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  lat: Latitude,
  lng: Longitude,
});

export const CreateMeetupInput = z.strictObject({
  groupId: Id,
  title: z.string().trim().min(1).max(80),
  // Must be in the future at the moment it's parsed. The server parses on
  // every request, so a stale client clock can't get a past start through.
  startsAt: Timestamp.refine((v) => Date.parse(v) > Date.now(), {
    message: "Start time must be in the future",
  }),
  meetingPoint: MeetingPointInput,
});
export type CreateMeetupInput = z.infer<typeof CreateMeetupInput>;

// Cancel, RSVP and withdraw all address one meetup by id (in the path).
export const MeetupIdParams = z.object({ meetupId: Id });
export type MeetupIdParams = z.infer<typeof MeetupIdParams>;

// ---------------------------------------------------------------------
// Write responses
// ---------------------------------------------------------------------
export const CreateMeetupResponse = z.object({ id: Id });
export type CreateMeetupResponse = z.infer<typeof CreateMeetupResponse>;

export const CancelMeetupResponse = z.object({
  id: Id,
  status: z.literal("cancelled"),
});
export type CancelMeetupResponse = z.infer<typeof CancelMeetupResponse>;

export const RsvpResponse = z.object({
  meetupId: Id,
  attending: z.boolean(),
});
export type RsvpResponse = z.infer<typeof RsvpResponse>;

export const ApiErrorCode = z.enum([
  "invalid_input",
  "unauthorized",
  "not_found",
  "forbidden",
  "conflict",
  "internal",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
    issues: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

// ---------------------------------------------------------------------
// Reads (the app queries these views directly under RLS)
// ---------------------------------------------------------------------
export const Group = z.object({ id: Id, name: z.string() });
export type Group = z.infer<typeof Group>;
export const GROUP_COLUMNS = "id,name";

export const MeetupStatus = z.enum(["scheduled", "cancelled"]);
export type MeetupStatus = z.infer<typeof MeetupStatus>;

// What the server lets this member see of the meeting point. The database
// decides: the exact columns are null unless the caller is the creator or
// has RSVP'd, so "approximate" is not the app hiding anything.
export const MeetingPointView = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("exact"),
    name: z.string(),
    lat: Latitude,
    lng: Longitude,
  }),
  z.object({
    kind: z.literal("approximate"),
    centerLat: Latitude,
    centerLng: Longitude,
    radiusM: z.number().int().min(300),
  }),
]);
export type MeetingPointView = z.infer<typeof MeetingPointView>;

// Row shape of the public.meetup_details view.
const MeetupDetailsRow = z.object({
  id: Id,
  group_id: Id,
  title: z.string(),
  starts_at: Timestamp,
  status: MeetupStatus,
  cancelled_at: Timestamp.nullable(),
  created_by: Id,
  creator_name: z.string().nullable(),
  is_creator: z.boolean(),
  has_rsvp: z.boolean(),
  attendee_count: z.number().int(),
  meeting_point_name: z.string().nullable(),
  meeting_point_lat: Latitude.nullable(),
  meeting_point_lng: Longitude.nullable(),
  area_lat: Latitude,
  area_lng: Longitude,
  area_radius_m: z.number().int(),
});

export const MEETUP_COLUMNS = Object.keys(MeetupDetailsRow.shape).join(",");

export const Meetup = MeetupDetailsRow.transform((r) => ({
  id: r.id,
  groupId: r.group_id,
  title: r.title,
  startsAt: r.starts_at,
  status: r.status,
  cancelledAt: r.cancelled_at,
  createdBy: r.created_by,
  creatorName: r.creator_name,
  isCreator: r.is_creator,
  hasRsvp: r.has_rsvp,
  attendeeCount: r.attendee_count,
  meetingPoint: MeetingPointView.parse(
    r.meeting_point_name !== null &&
      r.meeting_point_lat !== null &&
      r.meeting_point_lng !== null
      ? {
          kind: "exact",
          name: r.meeting_point_name,
          lat: r.meeting_point_lat,
          lng: r.meeting_point_lng,
        }
      : {
          kind: "approximate",
          centerLat: r.area_lat,
          centerLng: r.area_lng,
          radiusM: r.area_radius_m,
        },
  ),
}));
export type Meetup = z.output<typeof Meetup>;

// Row shape of the public.meetup_attendees view.
export const Attendee = z
  .object({ user_id: Id, display_name: z.string() })
  .transform((r) => ({ userId: r.user_id, displayName: r.display_name }));
export type Attendee = z.output<typeof Attendee>;
export const ATTENDEE_COLUMNS = "user_id,display_name";
