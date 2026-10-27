// The write endpoint, with the same four roles. Each test creates its own
// meetup (Avery creates in Maple Street Walkers) so the seeded reference
// meetups stay untouched for the read tests.
import { beforeEach, describe, expect, test } from "vitest";
import { ATTENDEE_COLUMNS } from "@altair/contracts";
import {
  api, asOwner, createMeetup, inDays, meetupBody, readMeetup, readMeetups, signIn,
} from "./client.ts";
import { groups, meetups, users } from "./fixtures.ts";

describe("create a meetup", () => {
  test("a member can create one; the creator comes from the session", async () => {
    const sam = await signIn("sam");
    const res = await api(sam, "POST", "", meetupBody(groups.maple, { title: "  Padded title  " }));
    expect(res.status).toBe(201);

    const m = await readMeetup(sam, res.body.id);
    expect(m).toMatchObject({ title: "Padded title", status: "scheduled", isCreator: true, groupId: groups.maple });
    expect(m.meetingPoint.kind).toBe("exact");
  });

  test("the stored approximate area is >= 300 m and not centered on the exact point", async () => {
    const sam = await signIn("sam");
    const id = await createMeetup(sam, groups.maple);
    const [row] = await asOwner(
      `select m.area_radius_m, m.area_lat = p.lat and m.area_lng = p.lng as centered
       from meetups m join meetup_meeting_points p on p.meetup_id = m.id where m.id = $1`,
      [id],
    );
    expect(row.area_radius_m).toBeGreaterThanOrEqual(300);
    expect(row.centered).toBe(false);
  });

  test("rejects a start time in the past, or right now", async () => {
    const sam = await signIn("sam");
    for (const startsAt of [inDays(-1), new Date().toISOString()]) {
      const res = await api(sam, "POST", "", meetupBody(groups.maple, { startsAt }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_input");
      expect(res.body.error.issues).toContainEqual(expect.objectContaining({ path: "startsAt" }));
    }
  });

  test("rejects invalid input with a clear error", async () => {
    const sam = await signIn("sam");
    const cases: [string, Record<string, unknown>][] = [
      ["title", { title: "   " }],
      ["title", { title: "x".repeat(81) }],
      ["meetingPoint.name", { meetingPoint: { name: "", lat: 40, lng: -100 } }],
      ["meetingPoint.lat", { meetingPoint: { name: "Somewhere", lat: 91, lng: -100 } }],
      ["meetingPoint.lng", { meetingPoint: { name: "Somewhere", lat: 40, lng: -181 } }],
      ["startsAt", { startsAt: "next tuesday" }],
      ["groupId", { groupId: "not-a-uuid" }],
    ];
    for (const [path, override] of cases) {
      const res = await api(sam, "POST", "", meetupBody(groups.maple, override));
      expect(res.status, path).toBe(400);
      expect(res.body.error.issues, path).toContainEqual(expect.objectContaining({ path }));
    }
  });

  test("an attempt to set the creator in the body is rejected", async () => {
    const sam = await signIn("sam");
    const res = await api(sam, "POST", "", meetupBody(groups.maple, { createdBy: users.avery.id }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_input");
  });

  test("an outsider can't create in a group they're not in, and learns nothing about it", async () => {
    const taylor = await signIn("taylor");
    const res = await api(taylor, "POST", "", meetupBody(groups.maple));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  test("a member of one group can't create in the other", async () => {
    const sam = await signIn("sam");
    expect((await api(sam, "POST", "", meetupBody(groups.riverside))).status).toBe(404);
  });

  test("requires a signed-in user", async () => {
    expect((await api(null, "POST", "", meetupBody(groups.maple))).status).toBe(401);
  });
});

describe("cancel a meetup: creator only", () => {
  let id: string;
  beforeEach(async () => {
    id = await createMeetup(await signIn("avery"), groups.maple);
    expect((await api(await signIn("jordan"), "POST", `/${id}/rsvp`)).status).toBe(200);
  });

  test("outsider gets not found; members who aren't the creator get forbidden", async () => {
    expect((await api(await signIn("taylor"), "POST", `/${id}/cancel`)).status).toBe(404);
    expect((await api(await signIn("sam"), "POST", `/${id}/cancel`)).status).toBe(403);
    expect((await api(await signIn("jordan"), "POST", `/${id}/cancel`)).status).toBe(403);
    expect((await readMeetup(await signIn("avery"), id)).status).toBe("scheduled");
  });

  test("the creator can cancel; it stays visible to members, marked cancelled, with attendees", async () => {
    const res = await api(await signIn("avery"), "POST", `/${id}/cancel`);
    expect(res).toEqual({ status: 200, body: { id, status: "cancelled" } });

    for (const p of ["avery", "jordan", "sam"] as const) {
      const m = await readMeetup(await signIn(p), id);
      expect(m.status, p).toBe("cancelled");
      expect(m.cancelledAt, p).not.toBeNull();
    }
    const { data } = await (await signIn("sam")).db
      .from("meetup_attendees").select(ATTENDEE_COLUMNS).eq("meetup_id", id);
    expect(data!.map((a) => a.display_name)).toEqual([users.jordan.name]);

    expect(await readMeetups(await signIn("taylor"), { id })).toEqual([]);
  });

  test("a cancelled meetup accepts no new RSVP", async () => {
    await api(await signIn("avery"), "POST", `/${id}/cancel`);
    const res = await api(await signIn("sam"), "POST", `/${id}/rsvp`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("conflict");
    expect((await readMeetup(await signIn("sam"), id)).hasRsvp).toBe(false);
  });

  test("cancelling is final: it can't be reopened, even by the database owner", async () => {
    await api(await signIn("avery"), "POST", `/${id}/cancel`);
    expect((await api(await signIn("avery"), "POST", `/${id}/cancel`)).status).toBe(200);
    await expect(
      asOwner(`update meetups set status = 'scheduled', cancelled_at = null where id = $1`, [id]),
    ).rejects.toThrow(/cancelled and cannot be changed/);
  });

  test("an existing attendee can still withdraw from a cancelled meetup", async () => {
    await api(await signIn("avery"), "POST", `/${id}/cancel`);
    const res = await api(await signIn("jordan"), "DELETE", `/${id}/rsvp`);
    expect(res).toEqual({ status: 200, body: { meetupId: id, attending: false } });
    expect((await readMeetup(await signIn("jordan"), id)).hasRsvp).toBe(false);
  });
});

describe("RSVP and withdraw", () => {
  let id: string;
  beforeEach(async () => {
    id = await createMeetup(await signIn("avery"), groups.maple);
  });

  test("a member's RSVP reveals the exact point to them, and withdrawing hides it again", async () => {
    const sam = await signIn("sam");
    expect((await readMeetup(sam, id)).meetingPoint.kind).toBe("approximate");

    expect(await api(sam, "POST", `/${id}/rsvp`)).toEqual({
      status: 200,
      body: { meetupId: id, attending: true },
    });
    const after = await readMeetup(sam, id);
    expect(after.hasRsvp).toBe(true);
    expect(after.meetingPoint).toMatchObject({ kind: "exact", name: "Fountain plaza, Town Green" });

    expect((await api(sam, "DELETE", `/${id}/rsvp`)).status).toBe(200);
    expect((await readMeetup(sam, id)).meetingPoint.kind).toBe("approximate");
  });

  test("RSVPing twice is not an error and leaves one RSVP", async () => {
    const sam = await signIn("sam");
    expect((await api(sam, "POST", `/${id}/rsvp`)).status).toBe(200);
    expect((await api(sam, "POST", `/${id}/rsvp`)).status).toBe(200);
    const [{ count }] = await asOwner(
      `select count(*)::int as count from rsvps where meetup_id = $1 and user_id = $2`,
      [id, users.sam.id],
    );
    expect(count).toBe(1);
  });

  test("withdrawing without an RSVP is a no-op", async () => {
    expect((await api(await signIn("sam"), "DELETE", `/${id}/rsvp`)).status).toBe(200);
  });

  test("an outsider can neither RSVP nor withdraw, and gets not found", async () => {
    const taylor = await signIn("taylor");
    expect((await api(taylor, "POST", `/${id}/rsvp`)).status).toBe(404);
    expect((await api(taylor, "DELETE", `/${id}/rsvp`)).status).toBe(404);
  });

  test("a member can only RSVP for themselves: the body can't name someone else", async () => {
    const sam = await signIn("sam");
    // The route takes no body; whoever is signed in is who RSVPs.
    expect((await api(sam, "POST", `/${id}/rsvp`, { userId: users.jordan.id })).status).toBe(200);
    expect((await readMeetup(await signIn("jordan"), id)).hasRsvp).toBe(false);
    expect((await readMeetup(sam, id)).hasRsvp).toBe(true);
  });

  test("a started meetup accepts no RSVP", async () => {
    // Set up as the database owner, as the brief allows.
    await asOwner(`update meetups set starts_at = now() - interval '1 minute' where id = $1`, [id]);
    const res = await api(await signIn("sam"), "POST", `/${id}/rsvp`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/started/);
  });

  test("an unknown meetup id looks the same as one you can't see", async () => {
    const res = await api(await signIn("sam"), "POST", `/00000000-0000-4000-8000-000000000000/rsvp`);
    expect(res.status).toBe(404);
  });

  test("a malformed meetup id is rejected by the shared schema", async () => {
    const res = await api(await signIn("sam"), "POST", `/not-a-uuid/rsvp`);
    expect(res.status).toBe(400);
    expect(res.body.error.issues).toContainEqual(expect.objectContaining({ path: "meetupId" }));
  });
});

describe("seeded reference meetups are untouched by this file", () => {
  test("Saturday morning loop is still scheduled", async () => {
    expect((await readMeetup(await signIn("avery"), meetups.saturday.id)).status).toBe("scheduled");
  });
});
