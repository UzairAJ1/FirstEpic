# Talking points (working notes for NOTE.md and the recording)

Short notes, collected as we build. Each one is a moment worth explaining:
what I directed, what I caught, and why.

## Caught or fixed during review
- **Supabase's default grants are wide open.** anon and authenticated get ALL privileges
  (including INSERT, DELETE and TRUNCATE) on every public table, and on future tables too.
  RLS was the only thing in the way. The migration revokes them and changes the default
  privileges. (Phase 0)
- **The D4 offset was too narrow.** The plan was a 400 m circle with its center 120–250 m from
  the true point. The algorithm is public, so the true spot would have been known to lie in that
  small ring. Revised to a 500 m circle with the center 100–450 m away, uniform over the ring's
  area. (Phase 1)
- **The AI's first stats check was wrong.** Postgres evaluated the random function once and
  reused it for all 10k rows, so min, max and avg were identical. Caught because the numbers
  were too perfect, and re-run with per-row evaluation. (Phase 1)
- **Windows PowerShell 5.1 broke a commit message** that contained double quotes. Switched to
  committing from a message file. (Phase 1, minor tooling)

- **The D1 spike de-risked Deno sharing first.** I time-boxed it to 20 minutes with a Node
  fallback; it passed in about 5. (Phase 2)

- **A test failure that was the test's fault.** "Sam sees no meeting points" failed because
  another test file had made Sam the creator of some meetups, and creators do see their own.
  The database was right and the test's assumption was wrong, so I scoped the check to the
  meetup under test rather than weakening the rule. (Phase 3)
- **Single function vs four (D1).** I changed this without asking first and the owner
  questioned it. Real gains: one `deno.json` and one warm worker. Shared code alone isn't a
  reason (`_shared/` works with four). Cost: no per-endpoint deploy, logs or config. (Phase 2–3)

- **The client cache leaked across accounts.** React Query kept the previous user's meetups
  after sign-out, so the next account on the same phone would briefly see them. The cache is
  cleared whenever the signed-in user id changes. (Phase 4)
- **Two copies of React in the monorepo.** expo-doctor found 19.3.0 (app) and 19.3.1 (hoisted
  to the root), which causes "Invalid hook call" at runtime. Fixed with an npm `overrides` entry;
  a plain reinstall didn't apply it, so I removed the lockfile and reinstalled clean. (Phase 4)
- **Checked the date picker API instead of trusting memory.** In datetimepicker v9 `onChange`
  is deprecated in favour of `onValueChange` and `onDismiss`. Read the installed `.d.ts` because
  the Expo docs page didn't say. (Phase 4)

- **Running on a real phone over Wi-Fi.** Diagnosed step by step: (1) a "Web Bundling failed"
  error was a red herring, because something requested the web bundle (web is out of scope).
  Removed web from `app.json` platforms. (2) The phone couldn't reach the laptop: the Node
  firewall rule had been created while the Wi-Fi was "Public", so it allowed Public only.
  After switching the network to Private, nothing was allowed. Fixed with one inbound rule
  for TCP 8081 and 54321 on the Private profile only. (Phase 4)

## Tests (48, Vitest, real Supabase Auth sessions, real API)
- The four personas on the seeded Saturday loop: outsider, member without RSVP, attendee, creator.
- Multi-group: Riley gets exact for Saturday and approximate for Weeknight and Riverside; an RSVP
  to one meetup unlocks only that one; raw map payloads scanned for exact values.
- Writes: past or current start rejected; strict body; creator-only cancel (404 outsider, 403
  member); cancelled meetup takes no RSVP; reopening fails even for the DB owner (trigger);
  withdraw from a cancelled meetup works; a started meetup (set up as owner) takes no RSVP;
  RSVP is idempotent.
- Bypass: every direct table write and RPC call with a user session is `42501`; helpers are
  not exposed; `home_lat` is denied for all, even on your own row.
- **Automatic leak scan:** every response body in every test file is checked for all 16
  seeded home coordinates.
- Re-runnable without a reset: mutation tests create their own meetups.

## Design choices worth explaining
- **One contract file** (`packages/contracts`). The server validates writes with it, and the
  app parses reads with it. A discriminated union, `exact | approximate`, for the meeting point
  means the app renders whatever the server allowed.
- **Strict input schemas.** Sending `createdBy` returns 400 "Unrecognized key". The acting
  user comes only from the verified JWT (`auth.getUser`).
- **Unexpected DB errors are logged, never echoed**, since they can carry row data. Only our
  own AT* error messages are forwarded.
- **Split table for the meeting point.** RLS filters rows, not columns, so the exact place
  became its own row. The map updates after RSVP with no special code.
- **Column grant on users.** Only (id, display_name) is readable, so `home_lat` gives
  permission denied for everyone, even on their own row.
- **Writes go only through the endpoints.** No write grants, and the write functions are
  executable by service_role only. Direct table or RPC writes from the app are denied (shown
  in the smoke test).
- **Outsiders get 404, never 403**, so an error can't confirm a meetup exists.
- **Rules live in two layers.** Zod checks shape and the future start time with clear errors;
  the DB function plus triggers check data rules atomically and can't be bypassed.
- **Area stored once per meetup**, so repeated reads can't be averaged back to the exact point.
- **Helpers live in a `private` schema** that PostgREST doesn't expose.

- **App writes never touch the Supabase client.** `api.ts` calls the Edge Function with the
  session token. Reads use the client against the views under RLS.
- **The create form validates with the same `CreateMeetupInput` as the server**, so the user
  sees errors instantly. The server still re-validates and shows its own errors (e.g. past
  start) field by field.
- **The map renders the server's union** (pin or circle) and remounts when it changes, so after
  an RSVP the camera moves to the exact pin. `showsUserLocation` is off. The picker map opens on
  the town reference point, never on a home location.
- **Outsider opening a meetup link:** RLS returns no row, and the app shows "This meetup isn't
  available", the same as for a deleted meetup.

## Bonus (a): edit a meetup
- `PATCH /meetups/:id`, same Zod layer; `update_meetup()` is service_role-only like the
  other writes. No UPDATE grant for users (tested: direct UPDATE and RPC are both `42501`).
- **Partial edits:** send only what changed. The future-start rule applies only when the
  start time changes. A started meetup can still get a title fix. Checked twice: Zod at the
  endpoint, and the DB function behind it (tested by calling it as owner).
- **Cancelled can't be edited:** 409 from the function, and the existing trigger blocks any
  writer.
- **Moving the point creates a new approximate area**, but only if the coordinates really
  changed. Re-saving the same point keeps the old circle, so repeated saves can't be averaged
  back to the exact spot. Tested.
- One shared `FutureTimestamp` schema for create and edit, so the rule can't drift.
- The create and edit screens share one `MeetupForm` component.
- 10 tests in `edit.test.ts` (58 total).

## Assumptions (spec is silent)
- A member can withdraw an RSVP after the meetup has started.
- The creator can cancel after the meetup has started.
- Cancelling twice, or withdrawing without an RSVP, is a quiet no-op (like RSVPing twice).
- Edit: a started meetup can still be edited as long as the start time isn't changed.
- Edit: existing RSVPs are kept when the time or place changes.

## More pushback candidates
- **Editing time or place under existing RSVPs.** People said yes to a specific time and
  place. Without notifications (out of scope), attendees won't know it moved. A product would
  either notify them or reset RSVPs on a material change.

## Pushback / refuse-first candidates
- **Pushback:** RSVP-then-withdraw reveals the exact point to any member. Approximate is
  protection from casual viewing, not from a determined group member.
- **Pushback:** the starter keeps private home location in the same table as the public
  profile. It belongs in a separate table with no API grants.
- **Pushback:** the attendee list is visible before RSVP and reveals who will be at the spot.
- **Refuse-first:** anything derived from home location ("near me"); live location sharing
  before a consent and privacy model exists.

## Recording beats
- Show Taylor (outsider) seeing nothing, in the app and via a direct API call.
- Show Sam's map as an approximate circle, then RSVP, then the exact pin.
- Show the direct-write attempts failing (insert into rsvps, rpc/rsvp, select home_lat).
- Show Riley (both groups) getting exact for one meetup and approximate for the others.
