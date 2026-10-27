// The multi-group case (spec section 6): "A member of several groups sees
// each group's meetups according to their own status in that meetup. An
// RSVP to one meetup grants nothing for any other meetup."
//
// Riley Chen is in both groups and has RSVP'd to "Saturday morning loop" only.
import { describe, expect, test } from "vitest";
import { ATTENDEE_COLUMNS } from "@altair/contracts";
import { api, createMeetup, readMeetup, readMeetups, signIn } from "./client.ts";
import { groups, meetups, users } from "./fixtures.ts";

const seeded = new Set<string>(Object.values(meetups).map((m) => m.id));

describe("Riley (both groups) map data", () => {
  test("each seeded meetup follows Riley's own status in it", async () => {
    const all = await readMeetups(await signIn("riley"));
    const byId = new Map(all.filter((m) => seeded.has(m.id)).map((m) => [m.id, m]));

    expect(byId.size).toBe(3);
    // RSVP'd: exact
    expect(byId.get(meetups.saturday.id)!.meetingPoint).toMatchObject({
      kind: "exact",
      name: meetups.saturday.place,
    });
    // Same group, not RSVP'd: approximate
    expect(byId.get(meetups.weeknight.id)!.meetingPoint.kind).toBe("approximate");
    // Other group, not RSVP'd: approximate
    expect(byId.get(meetups.riverside.id)!.meetingPoint.kind).toBe("approximate");
  });

  test("the raw map payload carries no exact point for meetups Riley hasn't RSVP'd", async () => {
    const { db } = await signIn("riley");
    const { data } = await db.from("meetup_details").select("*");
    const raw = JSON.stringify(data);
    for (const m of [meetups.weeknight, meetups.riverside]) {
      expect(raw).not.toContain(m.place);
      expect(raw).not.toContain(String(m.lat));
      expect(raw).not.toContain(String(m.lng));
    }
  });

  test("sees attendee lists in both groups", async () => {
    const { db } = await signIn("riley");
    const { data } = await db.from("meetup_attendees").select(ATTENDEE_COLUMNS).eq("meetup_id", meetups.riverside.id);
    expect(data!.map((a) => a.display_name)).toEqual([users.casey.name]);
  });

  test("an RSVP in one group unlocks only that meetup", async () => {
    const riley = await signIn("riley");
    const morgan = await signIn("morgan");
    const joined = await createMeetup(morgan, groups.riverside);
    const other = await createMeetup(morgan, groups.riverside);

    expect((await readMeetup(riley, joined)).meetingPoint.kind).toBe("approximate");
    expect((await api(riley, "POST", `/${joined}/rsvp`)).status).toBe(200);

    expect((await readMeetup(riley, joined)).meetingPoint.kind).toBe("exact");
    expect((await readMeetup(riley, other)).meetingPoint.kind).toBe("approximate");
    expect((await readMeetup(riley, meetups.weeknight.id)).meetingPoint.kind).toBe("approximate");
    expect((await readMeetup(riley, meetups.riverside.id)).meetingPoint.kind).toBe("approximate");
  });
});

describe("single-group members see only their group", () => {
  test("Sam (Maple) gets no Riverside meetups or attendees; Morgan (Riverside) no Maple ones", async () => {
    const sam = await signIn("sam");
    const morgan = await signIn("morgan");

    expect((await readMeetups(sam)).every((m) => m.groupId === groups.maple)).toBe(true);
    expect((await readMeetups(morgan)).every((m) => m.groupId === groups.riverside)).toBe(true);

    expect(await readMeetups(sam, { id: meetups.riverside.id })).toEqual([]);
    expect(await readMeetups(morgan, { id: meetups.saturday.id })).toEqual([]);

    const { data } = await sam.db.from("meetup_attendees").select("*").eq("meetup_id", meetups.riverside.id);
    expect(data).toEqual([]);
  });

  test("a shared member is visible by name, but only to people who share a group with them", async () => {
    const sam = await signIn("sam");
    const { data } = await sam.db.from("users").select("id,display_name");
    const names = data!.map((u) => u.display_name).sort();
    // Maple members only: Riley is visible because Riley is in Maple too.
    expect(names).toEqual([users.avery.name, users.jordan.name, users.riley.name, users.sam.name].sort());
  });
});
