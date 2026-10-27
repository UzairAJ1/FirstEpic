# Architecture decisions

Short records of the calls made before building, with the alternatives considered.
Reasoning that belongs in the submission note is expanded there (`docs/NOTE.md`).

## D1. Write layer: Supabase Edge Functions

- **Chosen:** Edge Functions (Deno). The build uses one `meetups` function with four routes:
  `POST /meetups`, `POST /meetups/:id/cancel`, `POST /meetups/:id/rsvp` and
  `DELETE /meetups/:id/rsvp`.
  - *Revised during the build:* the plan was one function per write. One function means one
    import map, one shared auth and error path, and one cold start.
- **Spike result:** passed in about 5 minutes. A relative `.ts` import of
  `packages/contracts/src/index.ts` plus `"zod": "npm:zod@4.6.7"` in the function's `deno.json`
  works with `supabase functions serve`. Zod is pinned to the same version in the app workspace.
- **Rejected:** a small Node TypeScript server. Simpler to share Zod with the app, but it's one more
  process for the reviewer to start, and it means verifying JWTs by hand.
- **Risk:** Deno has to import the shared Zod package from outside `supabase/functions/`.
  We give a spike 20 minutes. If Deno can't import `packages/contracts` cleanly through an import map
  and relative `.ts` imports, we fall back to a Node server and record why.

## D2. Repo layout: npm workspaces monorepo

```
supabase/            migrations/, seed.sql, functions/
packages/contracts/  shared Zod schemas + inferred types (only dependency: zod)
apps/mobile/         Expo React Native app
tests/               Vitest access tests against local Supabase
docs/                decisions, note
ai-logs/             exported Claude Code session logs
```

- **Rejected:** pnpm. Its symlinked `node_modules` still trips Metro occasionally, and npm workspaces
  are auto-detected by recent Expo SDKs.

## D3. Access enforcement: the database is the boundary

Every table in `public` is reachable through PostgREST with the anon key that ships in the app.
So hiding a column in the client protects nothing. GRANTs decide which tables and columns a role
may touch at all. RLS decides which rows. RLS can't hide part of a row, and both of our privacy
rules are about part of a row.

1. **The meeting point is a separate table.** `meetups` holds the public part: title, time,
   status and the approximate area. `meetup_meeting_points` holds the exact name and coordinates,
   and its RLS allows a read only by the creator or a member with an RSVP. A per-row
   column-visibility problem becomes a row-visibility problem, which RLS handles well. After an
   RSVP, the next read returns the row, so the map updates with no special code.
   - Rejected: a security-definer view with `CASE WHEN rsvp'd`. It bypasses RLS, so a single
     missing `WHERE` leaks everything, and Supabase's linter flags the pattern.
   - Rejected: read-only RPCs for everything. That's more hand-written code paths and more places
     to get it wrong.
2. **Home location: column grants.** `authenticated` gets `SELECT (id, display_name)` on
   `users` and nothing more. An RLS policy limits rows to users who share a group with the caller.
   A request for `home_lat` fails with *permission denied* for everyone.
3. **Writes are possible only through the endpoints.** `anon` and `authenticated` get no
   INSERT, UPDATE or DELETE on any table. The Postgres write functions are executable by
   `service_role` only. An Edge Function verifies the JWT, takes the user id from it (never from
   the request body), validates the input with the shared Zod schema, then calls the function.
   Zod covers shape, lengths and the future start time. The function covers rules that need data
   (membership, creator, cancelled, started) atomically.
   - Tradeoff: the function holds the service-role key and passes the user id itself. We keep
     that risk small with one shared, tested helper that gets the id only from the verified JWT.
4. **Reads come straight from the app under RLS**, through `security_invoker` views, so the
   caller's RLS still applies. Responses are parsed with the shared Zod schemas.
5. **Small `security definer` helpers** (`is_group_member`, `has_rsvp`, ...) return booleans
   only. They stop policies on related tables from recursing into each other.

## D4. Meeting point before RSVP: approximate area

- **Chosen:** members who haven't RSVP'd see an approximate area. They get neither the exact
  coordinates nor the place name.
- **Area:** a 500 m radius circle. Its center is offset from the exact point by 100–450 m in a
  random direction, with the distance drawn uniformly over the ring's area. The exact point is
  always inside the circle and never at its center. The area is computed once, when the meetup
  is created, and stored. If it were recomputed on every read, averaging many reads would
  recover the exact point.
  - *Revised during the build:* the first plan was a 400 m circle offset 120–250 m. The
    algorithm is public, so that would have told anyone the true point lay in a 120–250 m ring,
    a much smaller area than the 400 m circle shown. A wider offset band spreads the possible
    true point over most of the circle.
- **Why (for the people using the app):** A meetup post tells the whole group where one person
  and their dog will be, at an exact time, often a week ahead. Groups are neighbors, not close
  friends, and many walks are at dawn or dusk, sometimes alone. Seeing the exact spot should
  follow from committing to come, not from simply being in the group. Before RSVP, a member
  mainly needs to answer "is this walkable for me and my dog?", and a 500 m area answers that
  without being enough to find someone.
- **Known limit, to state honestly:** any member can RSVP, look and withdraw. This stops
  casual and passive exposure, not a determined group member.
