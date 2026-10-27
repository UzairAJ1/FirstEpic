// Live-map simulator and load generator for the bonus (b) sample.
//
// Broadcasts SIMULATED walkers (never real device or home locations) on a
// group's private Realtime channel, signed in as a member of that group.
// Run with Node 24+ (native TypeScript):
//
//   node tools/live-sim.ts                         25 walkers per group, 1 Hz, both groups
//   node tools/live-sim.ts --walkers 200 --clients 20 --measure --duration 60
//
// Options:
//   --group maple|riverside|all  which group's channel (default all; with --measure, maple)
//   --as <persona>            member to sign in as (default avery; riverside: morgan)
//   --walkers N               simulated walkers (default 25)
//   --hz R                    position updates per walker per second (default 1)
//   --clients K               spread walkers over K connections (default 1)
//   --measure                 also listen as another member and report delivery and latency
//   --duration S              stop after S seconds (default: run until Ctrl+C)

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

const API_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const PASSWORD = "altair-fixture-pass";
const GROUPS = {
  maple: { id: "b2000000-0000-4000-8000-000000000001", sender: "avery", listener: "sam" },
  riverside: { id: "b2000000-0000-4000-8000-000000000002", sender: "morgan", listener: "casey" },
} as const;

// ---------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------
function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const measure = process.argv.includes("--measure");
// Demo default: feed every group, so the live map works for any persona. Load
// probes default to one group so the numbers stay comparable.
const groupKey = option("group", measure ? "maple" : "all");
const groups =
  groupKey === "all" ? Object.values(GROUPS) : [GROUPS[groupKey as keyof typeof GROUPS]].filter(Boolean);
if (groups.length === 0) throw new Error(`--group must be one of: ${Object.keys(GROUPS).join(", ")}, all`);
const senderOverride = process.argv.includes("--as") ? option("as", "") : null;
const walkerCount = Number(option("walkers", "25"));
const hz = Number(option("hz", "1"));
const clientCount = Math.max(1, Math.min(Number(option("clients", "1")), walkerCount));
const duration = Number(option("duration", "0"));
const topicOf = (g: (typeof groups)[number]) => `live:group:${g.id}`;

// ---------------------------------------------------------------------
// Walkers: each loops a circle somewhere in the fictional town at walking
// speed. Deterministic per index so restarts look the same.
// ---------------------------------------------------------------------
const TOWN = { lat: 40.0, lng: -100.0 };
const M_PER_DEG = 111_320;

function seeded(i: number) {
  let s = (i + 1) * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

const walkers = Array.from({ length: walkerCount }, (_, i) => {
  const rand = seeded(i);
  const spreadM = 3000;
  const radiusM = 150 + rand() * 450;
  const speed = 1.1 + rand() * 0.6; // m/s
  return {
    id: `walker-${String(i + 1).padStart(3, "0")}`,
    name: `Walker ${i + 1}`,
    centerLat: TOWN.lat + ((rand() - 0.5) * 2 * spreadM) / M_PER_DEG,
    centerLng: TOWN.lng + ((rand() - 0.5) * 2 * spreadM) / (M_PER_DEG * Math.cos((TOWN.lat * Math.PI) / 180)),
    radiusM,
    omega: (speed / radiusM) * (rand() < 0.5 ? 1 : -1), // rad/s
    phase: rand() * 2 * Math.PI,
  };
});

function positionAt(w: (typeof walkers)[number], tSec: number) {
  const a = w.phase + w.omega * tSec;
  return {
    lat: w.centerLat + (w.radiusM * Math.sin(a)) / M_PER_DEG,
    lng: w.centerLng + (w.radiusM * Math.cos(a)) / (M_PER_DEG * Math.cos((w.centerLat * Math.PI) / 180)),
  };
}

// ---------------------------------------------------------------------
// Realtime helpers
// ---------------------------------------------------------------------
async function connect(persona: string): Promise<SupabaseClient> {
  const db = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: true } });
  const { data, error } = await db.auth.signInWithPassword({ email: `${persona}@example.test`, password: PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed for ${persona}: ${error?.message}`);
  await db.realtime.setAuth(data.session.access_token);
  return db;
}

function subscribe(channel: RealtimeChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reject(new Error(`${status} joining ${channel.topic}: ${err?.message ?? "not authorized?"}`));
      }
    });
  });
}

// ---------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------
const stats = { sent: 0, sendErrors: 0, received: 0, latencies: [] as number[] };
const timers: NodeJS.Timeout[] = [];
const clients: SupabaseClient[] = [];

async function runGroup(group: (typeof groups)[number]) {
  const topic = topicOf(group);
  const sender = senderOverride ?? group.sender;
  console.log(
    `live-sim: ${walkerCount} walkers @ ${hz} Hz over ${clientCount} connection(s) as ${sender} on ${topic}` +
      (measure ? ", measuring" : ""),
  );

  if (measure) {
    const listener = await connect(group.listener);
    clients.push(listener);
    const channel = listener.channel(topic, { config: { private: true } });
    channel.on("broadcast", { event: "pos" }, ({ payload }) => {
      stats.received++;
      // Same host, same clock: sentAt -> now is the end-to-end latency.
      if (typeof payload?.sentAt === "number") stats.latencies.push(Date.now() - payload.sentAt);
    });
    await subscribe(channel);
  }

  const start = Date.now();
  for (let c = 0; c < clientCount; c++) {
    const db = await connect(sender);
    clients.push(db);
    const channel = db.channel(topic, { config: { private: true } });
    await subscribe(channel);

    // Each walker sends on its own jittered timer, like independent phones.
    for (const w of walkers.filter((_, i) => i % clientCount === c)) {
      const periodMs = 1000 / hz;
      const tick = async () => {
        const { lat, lng } = positionAt(w, (Date.now() - start) / 1000);
        const result = await channel.send({
          type: "broadcast",
          event: "pos",
          payload: { id: w.id, name: w.name, lat, lng, sentAt: Date.now() },
        });
        if (result === "ok") stats.sent++;
        else stats.sendErrors++;
        timers.push(setTimeout(tick, periodMs * (0.9 + Math.random() * 0.2)));
      };
      timers.push(setTimeout(tick, Math.random() * periodMs));
    }
  }
}

async function main() {
  for (const group of groups) await runGroup(group);

  let last = { sent: 0, received: 0, at: Date.now() };
  timers.push(
    setInterval(() => {
      const secs = (Date.now() - last.at) / 1000;
      const sentRate = ((stats.sent - last.sent) / secs).toFixed(1);
      const recvRate = ((stats.received - last.received) / secs).toFixed(1);
      const lat = percentiles(stats.latencies.splice(0));
      console.log(
        `sent ${sentRate}/s  errors ${stats.sendErrors}` +
          (measure ? `  received ${recvRate}/s  latency p50 ${lat.p50} ms  p95 ${lat.p95} ms  max ${lat.max} ms` : ""),
      );
      last = { sent: stats.sent, received: stats.received, at: Date.now() };
    }, 5_000),
  );

  if (duration > 0) setTimeout(stop, duration * 1000);
}

function percentiles(values: number[]) {
  if (values.length === 0) return { p50: "-", p95: "-", max: "-" };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
}

async function stop() {
  for (const t of timers) clearTimeout(t);
  await Promise.all(clients.map((db) => db.removeAllChannels()));
  console.log(`done: sent ${stats.sent}, send errors ${stats.sendErrors}${measure ? `, received ${stats.received}` : ""}`);
  process.exit(0);
}

process.on("SIGINT", stop);
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
