// Every write must go through the Zod-validated endpoint. Prove that the
// app's own session can't write around it: not to a table, not to a
// Postgres function, not to a private helper. And prove home location
// can't be read at all.
import { describe, expect, test } from "vitest";
import { signIn } from "./client.ts";
import { groups, meetups, users } from "./fixtures.ts";

const PERMISSION_DENIED = "42501";

describe("direct writes with a member's session are denied", () => {
  test("insert, update and delete on every table", async () => {
    const { db } = await signIn("avery");
    const attempts = [
      db.from("meetups").insert({
        group_id: groups.maple, created_by: users.avery.id, title: "Sneaky", starts_at: new Date().toISOString(),
        area_lat: 40, area_lng: -100, area_radius_m: 500,
      }),
      db.from("meetup_meeting_points").insert({ meetup_id: meetups.saturday.id, name: "x", lat: 0, lng: 0 }),
      db.from("rsvps").insert({ meetup_id: meetups.weeknight.id, user_id: users.avery.id }),
      db.from("meetups").update({ status: "cancelled" }).eq("id", meetups.saturday.id),
      db.from("meetups").update({ title: "Renamed" }).eq("id", meetups.saturday.id),
      db.from("rsvps").delete().eq("meetup_id", meetups.saturday.id),
      db.from("group_memberships").insert({ group_id: groups.riverside, user_id: users.avery.id }),
      db.from("users").update({ display_name: "Hacked" }).eq("id", users.avery.id),
    ];
    for (const [i, result] of (await Promise.all(attempts)).entries()) {
      expect(result.error?.code, `attempt ${i}`).toBe(PERMISSION_DENIED);
    }
  });

  test("calling the write functions directly", async () => {
    const { db } = await signIn("avery");
    const calls = [
      db.rpc("cancel_meetup", { p_user_id: users.avery.id, p_meetup_id: meetups.saturday.id }),
      db.rpc("rsvp", { p_user_id: users.avery.id, p_meetup_id: meetups.weeknight.id }),
      db.rpc("withdraw_rsvp", { p_user_id: users.jordan.id, p_meetup_id: meetups.saturday.id }),
      db.rpc("create_meetup", {
        p_user_id: users.avery.id, p_group_id: groups.maple, p_title: "Sneaky",
        p_starts_at: new Date(Date.now() - 86_400_000).toISOString(),
        p_place_name: "x", p_lat: 40, p_lng: -100,
      }),
    ];
    for (const [i, result] of (await Promise.all(calls)).entries()) {
      expect(result.error?.code, `call ${i}`).toBe(PERMISSION_DENIED);
    }
  });

  test("the RLS helpers aren't reachable through the API at all", async () => {
    const { db } = await signIn("taylor");
    const { error } = await db.rpc("is_group_member", { p_group_id: groups.maple });
    expect(error?.code).toBe("PGRST202"); // function not found in the exposed schema
  });
});

describe("home location is unreadable for everyone", () => {
  test.each(["avery", "jordan", "sam", "taylor"] as const)("%s can't select home_lat/home_lng, even their own", async (p) => {
    const { db, userId } = await signIn(p);
    for (const columns of ["home_lat", "home_lng", "*", "id,display_name,home_lat"]) {
      const { data, error } = await db.from("users").select(columns).eq("id", userId);
      expect(error?.code, columns).toBe(PERMISSION_DENIED);
      expect(data, columns).toBeNull();
    }
  });

  test("not through an embedded join from the views either", async () => {
    const { db } = await signIn("sam");
    const { error } = await db.from("rsvps").select("meetup_id, users(home_lat)");
    expect(error).not.toBeNull();
  });
});
