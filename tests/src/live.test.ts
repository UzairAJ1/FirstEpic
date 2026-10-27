// Bonus (b): live positions are broadcast on a PRIVATE Realtime channel per
// group. Prove Realtime Authorization (RLS on realtime.messages) lets only
// that group's members receive or send.
import type { RealtimeChannel } from "@supabase/supabase-js";
import { afterEach, describe, expect, test } from "vitest";
import { signIn, type Session } from "./client.ts";
import { groups } from "./fixtures.ts";
import type { Persona } from "./fixtures.ts";

const mapleTopic = `live:group:${groups.maple}`;
const riversideTopic = `live:group:${groups.riverside}`;

type Joined = { channel: RealtimeChannel; status: string; received: unknown[] };
const opened: Joined[] = [];

async function join(persona: Persona, topic: string, isPrivate = true): Promise<Joined> {
  const session: Session = await signIn(persona);
  await session.db.realtime.setAuth(session.token);
  const received: unknown[] = [];
  const channel = session.db.channel(topic, { config: { private: isPrivate } });
  channel.on("broadcast", { event: "pos" }, (msg) => received.push(msg.payload));
  const status = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve("TIMED_OUT_LOCAL"), 8_000);
    channel.subscribe((s) => {
      if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
        clearTimeout(timer);
        resolve(s);
      }
    });
  });
  const joined = { channel, status, received };
  opened.push(joined);
  return joined;
}

async function waitFor(check: () => boolean, ms = 3_000) {
  const until = Date.now() + ms;
  while (!check() && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
}

afterEach(async () => {
  for (const j of opened.splice(0)) await j.channel.unsubscribe();
});

describe("private live channel per group", () => {
  test("members of the group can join it", async () => {
    expect((await join("sam", mapleTopic)).status).toBe("SUBSCRIBED");
    expect((await join("riley", mapleTopic)).status).toBe("SUBSCRIBED");
    expect((await join("riley", riversideTopic)).status).toBe("SUBSCRIBED");
  });

  test("an outsider, or a member of another group, can't join it", async () => {
    expect((await join("taylor", mapleTopic)).status).not.toBe("SUBSCRIBED");
    expect((await join("morgan", mapleTopic)).status).not.toBe("SUBSCRIBED");
  });

  test("a malformed topic is refused, not an error in the policy", async () => {
    expect((await join("sam", "live:group:not-a-uuid")).status).not.toBe("SUBSCRIBED");
  });

  test("a member's broadcast reaches other members", async () => {
    const sam = await join("sam", mapleTopic);
    const avery = await join("avery", mapleTopic);
    expect(avery.status).toBe("SUBSCRIBED");

    const payload = { id: "walker-1", name: "Walker 1", lat: 40.001, lng: -100.001 };
    expect(await avery.channel.send({ type: "broadcast", event: "pos", payload })).toBe("ok");

    await waitFor(() => sam.received.length > 0);
    expect(sam.received).toContainEqual(payload);
  });

  test("an outsider listening on a public channel of the same name hears nothing", async () => {
    const eavesdropper = await join("taylor", mapleTopic, false);
    const member = await join("sam", mapleTopic);
    const avery = await join("avery", mapleTopic);
    expect(avery.status).toBe("SUBSCRIBED");

    await avery.channel.send({ type: "broadcast", event: "pos", payload: { id: "walker-2", lat: 40, lng: -100 } });
    await waitFor(() => member.received.length > 0);

    expect(member.received.length).toBeGreaterThan(0);
    expect(eavesdropper.received).toEqual([]);
  });
});
