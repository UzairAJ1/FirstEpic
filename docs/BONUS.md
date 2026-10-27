# Bonus work

Both optional parts of the brief are built, tested, and runnable from the
[README](../README.md).

| | Bonus | Status |
|---|---|---|
| (a) | Edit a meetup | Done: endpoint, RLS, 10 tests, edit screen |
| (b) | Live map work sample | Done: private Realtime channel, simulator, animated avatars with interpolation and culling, 5 tests, one-page note |

---

## (a) Edit a meetup

**Brief:** a creator-only edit endpoint through the same Zod layer, which re-checks the
future-start rule when the start time changes, with its row-level security, a test and an edit
screen. The spec adds that a cancelled meetup can't be edited.

### What was built

| Piece | Where |
|---|---|
| Endpoint `PATCH /functions/v1/meetups/:id` | [supabase/functions/meetups/index.ts](../supabase/functions/meetups/index.ts) |
| Shared schema `UpdateMeetupInput` (partial; strict; ≥ 1 field) | [packages/contracts/src/index.ts](../packages/contracts/src/index.ts) |
| DB function `update_meetup()` (service_role only) | [supabase/migrations/20261027150000_update_meetup.sql](../supabase/migrations/20261027150000_update_meetup.sql) |
| Tests (10) | [tests/src/edit.test.ts](../tests/src/edit.test.ts) |
| Edit screen + shared create/edit form | [apps/mobile/src/app/edit/[id].tsx](../apps/mobile/src/app/edit/[id].tsx), [apps/mobile/src/components/MeetupForm.tsx](../apps/mobile/src/components/MeetupForm.tsx) |

### How each rule is enforced

- **Creator only.** `update_meetup()` checks the creator and returns 403 to other members and
  404 to outsiders. App users have no UPDATE grant on any table, and they can't execute the
  function. Both bypass attempts are tested and return `42501`.
- **The future-start rule re-checked when the start time changes:**
  - The endpoint validates `startsAt` with the same shared `FutureTimestamp` as create, so the
    two rules can't drift apart.
  - The DB function re-checks it as a backstop; a test calls the function directly as the owner.
  - An unchanged start time isn't re-checked, so a started meetup can still get a title fix.
    The app sends only changed fields.
- **A cancelled meetup can't be edited:**
  - The function returns 409.
  - The existing `meetups_guard_update` trigger also blocks any change to a cancelled row,
    whoever writes it.

**Moving the meeting point:**
- The exact place is updated, and a **new approximate area** is generated, since the old circle
  might not contain the new point.
- The area is regenerated **only if the coordinates actually change.** Re-saving the same point
  keeps the old circle, so repeated saves can't produce many random circles to average back to
  the exact spot. This is tested.

### In the app
As the creator, open a meetup and tap **Edit meetup**. The form is pre-filled, including the exact
point, which the creator always sees. Server errors show under the matching field.

### Decisions to flag
- Existing RSVPs are kept when the time or place changes. Telling attendees needs notifications,
  which are out of scope; see the pushback in [NOTE.md](NOTE.md).

---

## (b) Live map work sample

**Brief:** a small Mapbox + Supabase Realtime slice with animated avatars from broadcast positions,
using interpolation and viewport culling, plus a one-page note on latency and battery trade-offs
and how you'd load-test it. Any map SDK is accepted.

### What was built

| Piece | Where |
|---|---|
| Private channel per group + RLS on `realtime.messages` | [supabase/migrations/20261027170000_live_positions.sql](../supabase/migrations/20261027170000_live_positions.sql) |
| Live map screen (avatars, interpolation, culling) | [apps/mobile/src/app/live/[groupId].tsx](../apps/mobile/src/app/live/[groupId].tsx) |
| Shared payload schema `LivePosition` | [packages/contracts/src/index.ts](../packages/contracts/src/index.ts) |
| Simulator and load probe | [tools/live-sim.ts](../tools/live-sim.ts) |
| Tests (5) | [tests/src/live.test.ts](../tests/src/live.test.ts) |
| **One-page note:** latency, battery, load testing | [docs/live-map-note.md](live-map-note.md) |

### Key points
- **Simulated positions only.** `npm run live-sim` broadcasts walkers looping around the
  fictional town. The app never reads device GPS or anyone's home location. Real live location
  would need a consent model first, which is part of my refuse-first reasoning in
  [NOTE.md](NOTE.md).
- **Same access model as the rest of the slice:**
  - Topic `live:group:<id>` is a private channel.
  - RLS policies let only that group's members receive or send.
  - Tests cover an outsider, a member of the other group, a public channel with the same name,
    and a malformed topic: none of them get in.
- **The map SDK is react-native-maps** rather than Mapbox. The brief allows any SDK, and this
  runs in Expo Go without a custom build or a token.
- **Interpolation:**
  - Samples are stamped with the local arrival time, so the sender's clock doesn't matter.
  - Markers render about 1.2 s behind, interpolating between the two samples around that time.
  - If updates stall, a marker extrapolates for at most 0.5 s, then holds. Walkers silent for
    10 s are dropped.
- **Viewport culling:**
  - A cheap bounds check on each walker's last point, with a 15% margin, runs before any
    interpolation.
  - The overlay shows *known* vs *rendered*, so you can watch it work as you zoom.
- **Battery:**
  - The render loop runs at 15 fps.
  - Avatars are rasterized once.
  - The channel and the loop stop when the screen loses focus or the app goes to the background.
- **Untrusted input:** any member can post on the channel, so receivers validate each message
  with the shared schema and cap tracked walkers at 500.

### What load-probing found
Measured with `npm run live-sim -- --measure` (full table in the note):
- **Normal load:** 100% delivery, p95 ≤ 12 ms locally, up to 80 msg/s.
- **The limit:** local Realtime caps a project at **100 events/s**. Above it, `send()` still
  returns `ok`, but **messages are dropped silently**. So monitoring and load tests have to
  measure delivery at the *receiver*.
- **A corrected hypothesis:** I first suspected fan-out deliveries counted toward the limit. A
  run with about 160 deliveries/s at 40 msg/s delivered everything, which disproved it: the cap
  is on ingress.

### Try it
1. `npm run live-sim` (leave it running). It feeds both groups' channels.
2. In the app, sign in as any member, such as **Sam** → **Live map (demo)**.
3. Zoom in and out and watch *rendered* drop while *known* stays the same. **Show all** reframes
   the map on every walker.

Positions are broadcasts, not stored rows, so they aren't seed data: avatars appear only while
the simulator runs, and the screen says so when nothing is arriving.
