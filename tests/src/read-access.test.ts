// Who sees what (spec section 6), proven with the four personas on the
// seeded "Saturday morning loop":
//   Avery  creator          Jordan  member, RSVP'd
//   Sam    member, no RSVP  Taylor  outsider
import { describe, expect, test } from "vitest";
import { ATTENDEE_COLUMNS, Attendee } from "@altair/contracts";
import { anonClient, metersBetween, readMeetup, signIn } from "./client.ts";
import { groups, meetups, users } from "./fixtures.ts";

const saturday = meetups.saturday;

async function attendeeNames(persona: Parameters<typeof signIn>[0], meetupId: string) {
  const { db } = await signIn(persona);
  const { data, error } = await db
    .from("meetup_attendees")
    .select(ATTENDEE_COLUMNS)
    .eq("meetup_id", meetupId);
  expect(error).toBeNull();
  return data!.map((r) => Attendee.parse(r).displayName).sort();
}

describe("outsider (Taylor)", () => {
  test("reads nothing about the meetup, its attendees or its meeting point", async () => {
    const { db } = await signIn("taylor");

    for (const source of ["meetup_details", "meetups", "meetup_meeting_points"] as const) {
      const key = source === "meetup_meeting_points" ? "meetup_id" : "id";
      const { data, error } = await db.from(source).select("*").eq(key, saturday.id);
      expect(error, source).toBeNull();
      expect(data, source).toEqual([]);
    }
    for (const source of ["meetup_attendees", "rsvps"] as const) {
      const { data, error } = await db.from(source).select("*").eq("meetup_id", saturday.id);
      expect(error, source).toBeNull();
      expect(data, source).toEqual([]);
    }
  });

  test("sees no groups and no meetups at all", async () => {
    const { db } = await signIn("taylor");
    expect((await db.from("groups").select("id")).data).toEqual([]);
    expect((await db.from("group_memberships").select("group_id")).data).toEqual([]);
    expect((await db.from("meetup_details").select("id")).data).toEqual([]);
    expect((await db.from("meetup_attendees").select("user_id")).data).toEqual([]);
  });

  test("sees only their own profile name, no other member's", async () => {
    const { db } = await signIn("taylor");
    const { data } = await db.from("users").select("id,display_name");
    expect(data).toEqual([{ id: users.taylor.id, display_name: users.taylor.name }]);
  });
});

describe("member who hasn't RSVP'd (Sam)", () => {
  test("sees title, time and status, marked not creator / not attending", async () => {
    const m = await readMeetup(await signIn("sam"), saturday.id);
    expect(m).toMatchObject({
      title: "Saturday morning loop",
      status: "scheduled",
      isCreator: false,
      hasRsvp: false,
      attendeeCount: 2,
    });
  });

  test("sees the attendee list", async () => {
    expect(await attendeeNames("sam", saturday.id)).toEqual([users.jordan.name, users.riley.name]);
  });

  test("gets only an approximate area: >= 300 m, not centered on the exact point, containing it", async () => {
    const m = await readMeetup(await signIn("sam"), saturday.id);
    expect(m.meetingPoint.kind).toBe("approximate");
    if (m.meetingPoint.kind !== "approximate") return;

    const { centerLat, centerLng, radiusM } = m.meetingPoint;
    const offset = metersBetween(centerLat, centerLng, saturday.lat, saturday.lng);
    expect(radiusM).toBeGreaterThanOrEqual(300);
    expect(offset).toBeGreaterThanOrEqual(100);
    expect(offset).toBeLessThan(radiusM);
  });

  test("the exact coordinates and the place name never reach the client", async () => {
    const { db } = await signIn("sam");
    const responses = await Promise.all([
      db.from("meetup_details").select("*").eq("id", saturday.id),
      // Scoped to this meetup: Sam legitimately sees the exact point of
      // meetups Sam created (other test files create some).
      db.from("meetup_meeting_points").select("*").eq("meetup_id", saturday.id),
      db.from("meetups").select("*").eq("id", saturday.id),
    ]);
    const raw = JSON.stringify(responses.map((r) => r.data));
    expect(raw).not.toContain(saturday.place);
    expect(raw).not.toContain("Linden Park");
    expect(raw).not.toContain(String(saturday.lat));
    expect(raw).not.toContain(String(saturday.lng));
    expect(responses[1].data).toEqual([]);
  });
});

describe("member who has RSVP'd (Jordan)", () => {
  test("sees the exact meeting point and the attendee list", async () => {
    const m = await readMeetup(await signIn("jordan"), saturday.id);
    expect(m.hasRsvp).toBe(true);
    expect(m.isCreator).toBe(false);
    expect(m.meetingPoint).toEqual({
      kind: "exact",
      name: saturday.place,
      lat: saturday.lat,
      lng: saturday.lng,
    });
    expect(await attendeeNames("jordan", saturday.id)).toEqual([users.jordan.name, users.riley.name]);
  });
});

describe("creator (Avery)", () => {
  test("sees the exact meeting point without an RSVP, and is marked creator", async () => {
    const m = await readMeetup(await signIn("avery"), saturday.id);
    expect(m.isCreator).toBe(true);
    expect(m.hasRsvp).toBe(false);
    expect(m.creatorName).toBe(users.avery.name);
    expect(m.meetingPoint).toMatchObject({ kind: "exact", name: saturday.place });
  });

  test("being creator of one meetup reveals nothing exact about another", async () => {
    const m = await readMeetup(await signIn("avery"), meetups.weeknight.id);
    expect(m.meetingPoint.kind).toBe("approximate");
  });
});

describe("signed-out requests", () => {
  test("are denied for every read source", async () => {
    const db = anonClient();
    for (const source of [
      "meetup_details", "meetup_attendees", "meetups", "meetup_meeting_points",
      "rsvps", "groups", "group_memberships",
    ]) {
      const { data, error } = await db.from(source).select("*");
      expect(error?.code, source).toBe("42501");
      expect(data, source).toBeNull();
    }
    const { error } = await db.from("users").select("id,display_name").eq("id", users.sam.id);
    expect(error?.code).toBe("42501");
  });
});

describe("my groups", () => {
  test("returns only the caller's own groups", async () => {
    const names = async (p: Parameters<typeof signIn>[0]) =>
      ((await (await signIn(p)).db.from("groups").select("id")).data ?? []).map((g) => g.id).sort();
    expect(await names("sam")).toEqual([groups.maple]);
    expect(await names("morgan")).toEqual([groups.riverside]);
    expect(await names("riley")).toEqual([groups.maple, groups.riverside].sort());
    expect(await names("taylor")).toEqual([]);
  });
});
