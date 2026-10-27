# Note: group meetups slice (Altair)

Run instructions are in the [README](../README.md). The full decision records are in
[decisions.md](decisions.md), and the running log of findings is in
[talking-points.md](talking-points.md).

## How I worked

I built this with **Claude Code** (Claude Opus 5.5, VS Code extension), the only AI tool I
used. The session logs are exported in [`ai-logs/`](../ai-logs/). I set the order of work, made
the architecture and product calls after asking for options and tradeoffs, ran the app on my
phone, and debugged the device setup. The agent wrote most of the code and tests and reviewed
them as it went. I questioned changes I hadn't agreed to.

### What I directed

- **Write layer: Supabase Edge Functions** over a Node server (D1), with a 20-minute spike on
  the risky part first: can Deno import the shared Zod package from outside
  `supabase/functions/`? It passed in about 5 minutes. The fallback was a Node server.
- **One npm-workspaces monorepo** (D2) so the Edge Function and the app import the same
  `packages/contracts`.
- **Access model (D3), after asking for the details.** RLS filters rows, not columns, so:
  - the exact meeting point is its own table, readable only by the creator or attendees
  - home location is cut off with a **column grant**
  - **every write is impossible without the endpoint**: no write grants for app users, and the
    write functions are executable by `service_role` only
- **Approximate area before RSVP (D4)**, after weighing "exact" seriously (reasoning below).
- **Push-back on the agent:** it merged the four planned functions into one without asking. I
  questioned it. Its justification was one import map and one warm worker; shared code alone
  wasn't a reason, since `_shared/` works with four functions. I accepted it and the change is
  recorded in D1.
- **Device setup:** I chose Expo Go on my own Pixel over Wi-Fi, instead of the emulator or
  scrcpy, and we diagnosed the connection together (below).
- **Both bonus parts.**

### What was caught in review, and how it was fixed

| Issue | Caught by | Fix |
|---|---|---|
| Supabase grants `anon`/`authenticated` **ALL privileges** on every `public` table by default, including future ones. RLS was the only barrier. | agent, verifying grants after boot | Explicit `revoke` plus changed default privileges. `bypass.test.ts` proves direct writes are denied. |
| D4 as first planned (a 400 m circle, center 120–250 m off) leaked: with a public algorithm, the true point sits in a small ring | agent, reviewing its own plan | 500 m circle, offset 100–450 m, uniform over the ring's area. Stored once, so reads can't be averaged. |
| A stats check of the area function showed identical min, max and avg: Postgres evaluated `random()` once for all 10k rows | agent: "too perfect" numbers | Re-sampled per row: 100–449 m, mean 311 m (the expected value) |
| My first stated reason for D4 was "less load". That's wrong; it's a privacy call. | agent | Rewrote the rationale around the people using the app |
| A test asserted "Sam sees no meeting points" and failed: Sam had *created* meetups in another test, and creators should see their own | agent | Scoped the test to the meetup under test, without weakening the rule |
| The app's query cache would show the previous account's data to the next account on the same phone | agent | Cache cleared when the signed-in user changes |
| Two copies of React in the monorepo ("Invalid hook call" risk) | `expo-doctor` | npm `overrides`, then a clean reinstall when a plain one didn't apply it |
| The date picker API used from memory was deprecated in the installed v9 | agent, reading the `.d.ts` | `onValueChange` / `onDismiss` |
| Phone couldn't reach the laptop: the Node firewall rule had been created while the Wi-Fi was "Public", so it allowed Public only | me and the agent, step by step | Wi-Fi set to Private, plus one inbound rule for TCP 8081 and 54321 on Private only |
| Live channel payloads were unvalidated, though any member can post | agent | Shared `LivePosition` schema; receivers drop invalid messages and cap tracked walkers |
| Live tests failed only right after `db reset` (Realtime restarting) | agent, re-running before reporting | Test setup waits for a member's channel join |
| Over 100 events/s, Realtime **drops broadcasts silently** while `send()` returns `ok` | agent's load probe | Documented in the live-map note. My first hypothesis (fan-out counts) was disproved by a run and corrected. |

Dead ends and discards are in the log: the Supabase CLI via `npx` without a binary, Docker missing
from VS Code's PATH, a commit message mangled by PowerShell 5.1, a web-bundle error that was a
red herring, and a scrcpy/USB path I dropped for Wi-Fi.

## Product decision: approximate area until RSVP

Members who haven't RSVP'd see a **500 m circle**. They don't get the exact point or the place
name. After an RSVP, the next read includes the meeting-point row and the map shows the pin.
Withdrawing hides it again.

**Why:** a meetup post tells the whole group where one person and their dog will be, at an
exact time, often a week ahead. Groups are neighbors, not close friends, and many walks are at
dawn or dusk, sometimes alone. Seeing the exact spot should follow from committing to come,
not from simply being in the group. Before RSVP, a member mainly needs to answer "is this
walkable for me and my dog?", and a 500 m area answers that without being enough to find
someone.

**How:**
- The center is offset 100–450 m from the true point, in a random direction, uniform over the
  ring's area.
- It's computed once in the database and stored.
- It's regenerated only if the point actually moves.

**The honest limit:** any member can RSVP, look, and withdraw. This protects against casual and
passive exposure (screenshots, scrolling), not against a determined group member.

## What I'd refuse to build first

**Anything derived from home location: "meetups near me", sorting by distance from home,
"X km from you".** Even if the coordinates never leave the server, distance from home is a
signal. Results sorted or labelled by distance from home can be trilaterated back to the address
with a few queries from different points, or a few fake meetups. The spec forbids exposing
home location, and a derived feature leaks it indirectly. If we need "near me", it should
use the device's current location, with consent, at query time, and never the stored home.

## Pushback on the spec

1. **The RSVP gate is weak by design.** RSVP-then-withdraw reveals the exact point to any
   member. If the goal is safety, the gate should be something the creator controls (approving
   attendees, or "only people I've walked with"), or the spot should be revealed only near
   start time. I'd want to agree which threat we're defending against before calling it
   "private".
2. **Home location lives in the public profile table.** The starter puts `home_lat`/`home_lng`
   in `users`, next to `display_name`, so every feature that reads profiles is one `select *`
   away from a leak. Here a column grant makes it unreadable, but the fix is a separate
   `user_private` table with no API grants at all.
3. **Editing time or place doesn't involve existing attendees.** The edit bonus keeps RSVPs when
   the time or place changes, but people agreed to a specific time and place. Without
   notifications (out of scope), they won't know it moved. A product should notify them, or
   reset RSVPs on a material change.
4. **The attendee list is visible before RSVP.** It reveals *who* will be at the spot, which
   for the "where is this person going to be" concern is at least as sensitive as *where*. I
   built it as specified, but I'd raise it alongside the location decision.

## Assumptions (where the spec is silent)

- A member can withdraw an RSVP after the meetup has started. The creator can cancel after it
  has started.
- Cancelling twice, or withdrawing without an RSVP, is a quiet no-op (like RSVPing twice).
- Outsiders get **404**, never 403, from any write, so an error can't confirm a meetup exists.
- Edit (bonus): a started meetup can still be edited if the start time isn't changed. RSVPs
  are kept.

## What I didn't reach, and limits

- **Only Android was run**: Expo Go on a Pixel over Wi-Fi. iOS wasn't run, though nothing is
  Android-only except the date picker presentation.
- **App screens were checked by hand on the phone, not by automated UI tests.** Access is
  proven at the API, which is where it's enforced.
- **Local Supabase only.** The hosted path (`supabase link` / `db push`) wasn't exercised.
- **The live map uses simulated positions** and react-native-maps rather than Mapbox. It hasn't
  been profiled on a device. The interpolation and culling logic has no unit tests.
- **Boot time:** the database starter booted well within 30 minutes. Most setup time went to
  Windows issues: Docker missing from VS Code's PATH, and later the firewall profile for phone
  testing.
