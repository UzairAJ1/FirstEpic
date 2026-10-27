# Live map sample: latency, battery, load testing

Bonus (b). The app's **Live map (demo)** screen shows animated avatars from positions
broadcast on the group's private Supabase Realtime channel. `tools/live-sim.ts` generates
the positions. The map is react-native-maps (any SDK is accepted), so it runs in Expo Go.

**Scope and privacy.** Every position is simulated: walkers loop around the fictional town.
The app never reads device GPS and never touches home location. Channel `live:group:<id>` is
private, and RLS on `realtime.messages` lets only that group's members receive or send
(`20261027170000_live_positions.sql`, proven in `tests/src/live.test.ts`). Nothing is
persisted. Shipping *real* live location needs more first: explicit opt-in per walk, sharing
limited to the meetup's time window, an always-visible "sharing" indicator, and coarsening
near home.

## How it works
- **Receive:** each message is validated with the shared `LivePosition` Zod schema (any member
  can post, so the receiver trusts nothing). It's stamped with the *local arrival time*, so
  the sender's clock doesn't matter. The last 3 samples are kept per walker, with at most 500
  walkers.
- **Interpolate:** render ~1.2 s behind real time (about one update interval), so there is
  almost always a "next" sample to lerp toward: smooth motion with no snapping. If updates
  stall, extrapolate along the last velocity for ≤ 0.5 s, then hold. Walkers silent for 10 s
  are dropped.
- **Viewport culling:** each frame, a cheap bounds check on the last known point (plus a 15%
  margin) runs before any interpolation. Off-screen walkers cost no math and no markers. The
  overlay shows *known* vs *rendered*.

## Latency trade-offs
End-to-end = sampling interval + network up + Realtime fan-out + network down + **render
delay**. Measured locally (`--measure`, same host, so no clock skew): **p50 3 ms, p95 5–12 ms**
from send to receive at 25–80 msg/s. On mobile networks expect 50–300 ms per leg. The render
delay is a deliberate choice: 1.2 s of extra lag buys smooth motion. For walkers moving about
1.4 m/s that's under 2 m of error, which beats markers jumping 1.4 m every second. A
navigation-grade feature would shrink the buffer and accept some snapping.

## Battery trade-offs
- **Sender (would-be real phones):** GPS and the radio dominate. Use an adaptive rate (about
  1 Hz when moving, about 0.1 Hz or nothing when stationary, using the OS's
  significant-change APIs), and batch several fixes per message. Share only during the
  meetup window, and never from the background unless the user explicitly started sharing.
- **Receiver (this screen):** 15 fps render loop instead of 60 (4× fewer frames and map
  updates). Culling keeps marker count small. Avatar views are rasterized once
  (`tracksViewChanges` off after first draw). **The socket and loop stop when the screen loses
  focus or the app is backgrounded.**

## What load testing found (the important part)
Local Realtime caps the project at **`max_events_per_second = 100`** (`_realtime.tenants`).
Probes with `tools/live-sim.ts`:

| Run | Result |
|---|---|
| 25 walkers × 1 Hz, 1 connection | 100% delivered, p95 ≤ 12 ms |
| 80 walkers × 1 Hz, 1 connection | 100% delivered, p95 ≤ 6 ms |
| 40 walkers × 1 Hz, 4 connections (~160 deliveries/s) | 100% delivered |
| 120 walkers × 1 Hz, 1 connection | **sender saw `ok` for every send; receiver got ~0** |
| 200 × 2 Hz, 10 connections | 429s, fallback to REST, and the project throttled for a while afterwards |

Two lessons:
1. **Over the limit, broadcast fails silently for the sender.** So monitoring and load tests
   must measure on the *receiver*.
2. **A plan's message quota is the real ceiling, not CPU.** Scale by:
   - one channel per group (already done)
   - **batching**: one message per sender per few seconds carrying several fixes
   - a lower send rate when the viewport doesn't need it
   - for big groups, a server aggregator that sends one combined snapshot per tick
   - choosing the hosted plan or quota from that maths

   *(My first guess was that fan-out deliveries counted against the limit. The 40×4 run
   disproved it: locally it's ingress.)*

## How I'd load-test it properly
1. **Model:** P = peak concurrent sharers per group, G = active groups, R = Hz. Ingress is
   P·G·R per second, egress is P²·G·R per second. Check both against the plan's quotas.
2. **Generator:** `live-sim.ts` scaled out. Many processes or machines, one connection per
   simulated phone (`--clients`), real JWTs for distinct users, and joins ramped up gradually
   (joins/s is also capped).
3. **Measure on receivers:** a fleet of listeners records delivery ratio, p50/p95/p99 latency
   (`sentAt` on synchronized hosts, or round-trip echo), reconnects, and 429s. Pass/fail is
   delivery ≥ 99.9% and p95 < 500 ms at 2× expected peak.
4. **Ramp and soak:** step up 25%, 50%, 100%, 200% of peak. Then soak at peak for an hour to
   catch leaks and token-refresh problems (JWTs expire mid-session).
5. **Device side:** an Android profiler (energy and frame timing) on a mid-range phone with 50,
   200 and 500 known walkers, zoomed in vs out, to prove culling keeps frame time flat.
