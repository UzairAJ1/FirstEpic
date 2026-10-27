// Bonus: creator-only edit (PATCH /meetups/:id), through the same Zod layer.
// Avery creates a fresh meetup in Maple Street Walkers for each test and
// Jordan RSVPs to it, so all four roles are present.
import { beforeEach, describe, expect, test } from "vitest";
import {
  api, asOwner, createMeetup, inDays, metersBetween, readMeetup, signIn,
} from "./client.ts";
import { groups, users } from "./fixtures.ts";

const library = { name: "Front steps, Elm Avenue Library", lat: 40.003318, lng: -99.979762 };

let id: string;
beforeEach(async () => {
  id = await createMeetup(await signIn("avery"), groups.maple);
  expect((await api(await signIn("jordan"), "POST", `/${id}/rsvp`)).status).toBe(200);
});

describe("who can edit", () => {
  test("only the creator: outsider 404, members (with or without RSVP) 403", async () => {
    const body = { title: "Hijacked" };
    expect((await api(await signIn("taylor"), "PATCH", `/${id}`, body)).status).toBe(404);
    expect((await api(await signIn("sam"), "PATCH", `/${id}`, body)).status).toBe(403);
    expect((await api(await signIn("jordan"), "PATCH", `/${id}`, body)).status).toBe(403);
    expect((await readMeetup(await signIn("avery"), id)).title).toBe("Test walk");
  });

  test("the creator can change the title and start time", async () => {
    const startsAt = inDays(5);
    const res = await api(await signIn("avery"), "PATCH", `/${id}`, { title: "  Longer loop  ", startsAt });
    expect(res).toEqual({ status: 200, body: { id } });

    const m = await readMeetup(await signIn("sam"), id);
    expect(m.title).toBe("Longer loop");
    expect(Date.parse(m.startsAt)).toBe(Date.parse(startsAt));
  });

  test("a direct UPDATE or RPC call with the creator's own session is denied", async () => {
    const { db } = await signIn("avery");
    expect((await db.from("meetups").update({ title: "Direct" }).eq("id", id)).error?.code).toBe("42501");
    const rpc = await db.rpc("update_meetup", {
      p_user_id: users.avery.id, p_meetup_id: id, p_title: "Direct",
      p_starts_at: null, p_place_name: null, p_lat: null, p_lng: null,
    });
    expect(rpc.error?.code).toBe("42501");
  });
});

describe("future-start rule on edit", () => {
  test("a changed start time in the past or right now is rejected by the shared schema", async () => {
    const avery = await signIn("avery");
    for (const startsAt of [inDays(-1), new Date().toISOString()]) {
      const res = await api(avery, "PATCH", `/${id}`, { startsAt });
      expect(res.status).toBe(400);
      expect(res.body.error.issues).toContainEqual(expect.objectContaining({ path: "startsAt" }));
    }
  });

  test("the database re-checks it too, behind the endpoint", async () => {
    await expect(
      asOwner(
        `select public.update_meetup($1, $2, null, now() - interval '1 hour', null, null, null)`,
        [users.avery.id, id],
      ),
    ).rejects.toThrow(/must be in the future/);
  });

  test("a started meetup can still get a title fix if the start time isn't changed", async () => {
    await asOwner(`update meetups set starts_at = now() - interval '5 minutes' where id = $1`, [id]);
    const avery = await signIn("avery");
    expect((await api(avery, "PATCH", `/${id}`, { title: "Typo fixed" })).status).toBe(200);
    expect((await api(avery, "PATCH", `/${id}`, { startsAt: inDays(-1) })).status).toBe(400);
  });
});

describe("cancelled meetups", () => {
  test("can't be edited", async () => {
    const avery = await signIn("avery");
    await api(avery, "POST", `/${id}/cancel`);
    const res = await api(avery, "PATCH", `/${id}`, { title: "Back on" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("conflict");
    expect((await readMeetup(avery, id)).title).toBe("Test walk");
  });
});

describe("moving the meeting point", () => {
  test("attendees see the new exact point; non-RSVP members a new area that contains it", async () => {
    const avery = await signIn("avery");
    expect((await api(avery, "PATCH", `/${id}`, { meetingPoint: library })).status).toBe(200);

    const jordanView = await readMeetup(await signIn("jordan"), id);
    expect(jordanView.meetingPoint).toEqual({ kind: "exact", ...library });

    const samView = await readMeetup(await signIn("sam"), id);
    expect(samView.meetingPoint.kind).toBe("approximate");
    if (samView.meetingPoint.kind !== "approximate") return;
    const { centerLat, centerLng, radiusM } = samView.meetingPoint;
    const offset = metersBetween(centerLat, centerLng, library.lat, library.lng);
    expect(offset).toBeGreaterThanOrEqual(100);
    expect(offset).toBeLessThan(radiusM);

    const { data } = await (await signIn("sam")).db.from("meetup_details").select("*").eq("id", id);
    expect(JSON.stringify(data)).not.toContain(library.name);
  });

  test("re-saving the same point keeps the same area (no fresh circles to average)", async () => {
    const avery = await signIn("avery");
    await api(avery, "PATCH", `/${id}`, { meetingPoint: library });
    const before = await readMeetup(await signIn("sam"), id);
    await api(avery, "PATCH", `/${id}`, { meetingPoint: { ...library, name: "Library front steps" } });
    const after = await readMeetup(await signIn("sam"), id);
    expect(after.meetingPoint).toEqual(before.meetingPoint);
  });
});

describe("invalid edits", () => {
  test("empty body, unknown keys and bad values are rejected with a clear error", async () => {
    const avery = await signIn("avery");
    const cases: [unknown, string][] = [
      [{}, ""],
      [{ createdBy: users.sam.id }, ""],
      [{ title: "" }, "title"],
      [{ meetingPoint: { name: "Somewhere", lat: 91, lng: 0 } }, "meetingPoint.lat"],
      [{ meetingPoint: { name: "No coordinates" } }, "meetingPoint.lat"],
    ];
    for (const [body, path] of cases) {
      const res = await api(avery, "PATCH", `/${id}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.issues, JSON.stringify(body)).toContainEqual(expect.objectContaining({ path }));
    }
  });
});
