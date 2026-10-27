# Schema starter: setup

First Epic Workflow Challenge - Senior Full-Stack Engineer (ALTAIR).
Original First Epic material built for this workflow challenge. Nothing here is a real product's code or data.

Read `altair-feature-spec.html` first. The database starter is designed to boot (database up, seed
loaded, one seed account signed in) in under 30 minutes once Docker (or a hosted Supabase project)
is ready.

## What is in this folder

```
altair-schema-starter.sql           users, groups, group_memberships (RLS on, no policies)
supabase/migrations/                empty: your timestamped migrations go here
README.md                           this file
```

The seed data is a separate file, `altair-seed-data.sql`.

**About the seed.** PART 1 of the seed writes to the Supabase auth tables (`auth.users` and
`auth.identities`) so the seed accounts can sign in with email and password, then loads the
starter tables. It must run as the database owner, which is what happens in both paths below
(local `supabase/seed.sql`, or the hosted SQL editor). It is written for real Supabase, local
(`supabase start`) or the hosted free tier.

## 1. Database: pick ONE path

### Path A: local Supabase (Supabase CLI, needs Docker)

From an empty project folder:

```
supabase init
```

Then copy these files into the generated `supabase/` folder (create `supabase/migrations/` if
`supabase init` didn't):

- `altair-schema-starter.sql` to `supabase/migrations/20261001000000_starter.sql`
  (any timestamp that sorts before your own migrations)
- `altair-seed-data.sql` to `supabase/seed.sql`

Then:

```
supabase start
supabase db reset
```

`supabase db reset` applies every migration in order, then `supabase/seed.sql`. Run it again
whenever you add a migration or want a clean database. `supabase status` prints the API URL and
the anon key.

### Path B: hosted Supabase (free tier, no Docker)

1. Create a free project.
2. Apply the starter ONCE, by exactly one of these, never both:
   - paste `altair-schema-starter.sql` into the SQL editor and run it; or
   - put it in `supabase/migrations/` as in Path A and run `supabase link` then `supabase db push`.
3. Apply your own migrations the same way you applied the starter.
4. Paste PART 1 of `altair-seed-data.sql` into the SQL editor and run it.

The API URL and anon key are under the project's API settings.

### Seed PART 2

The reference meetups and RSVPs are commented out at the bottom of the seed file, because your
meetup and RSVP tables do not exist yet. Once your migrations create them, adapt PART 2 to your
column names and load it (uncomment it in `supabase/seed.sql` and reset, or run it in the SQL
editor). Start times are relative to load time, so the meetups are always upcoming.

### Seed accounts

Emails are `<firstname>@example.test` (for example `sam@example.test`); every password is
`altair-fixture-pass`. The spec lists who is in which group. Quick check that sign-in works:

```
curl -s "$API_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"sam@example.test","password":"altair-fixture-pass"}'
```

A JSON body with an `access_token` means you are set.

## 2. App: Expo React Native

```
npx create-expo-app@latest
npx expo install @supabase/supabase-js
```

One platform is enough: iOS simulator, Android emulator, a device, or Expo Go. The web client is
out of scope. Point the app at your API URL and anon key. Never put the service role key in the app.
On a device or Android emulator, use your machine's LAN IP (or 10.0.2.2 on the Android emulator)
instead of 127.0.0.1 for a local API URL.

## 3. Map

Any map option is fine. A path that needs no account and no card exists: `react-native-maps` with the platform's
default map (`npx expo install react-native-maps`), which works in Expo Go and on the iOS
simulator or an Android emulator without your own map key. SDKs that need an account or a
development build (`npx expo run:ios` or `npx expo run:android`) also work. Keep any tokens out
of the repository.

The seed coordinates sit around an arbitrary reference point (40.0000 N, 100.0000 W) in a
fictional town. They do not match the place names on a real map, and they are not real addresses.

## 4. Endpoints and shared schemas

Writes (create a meetup, RSVP, withdraw an RSVP, cancel a meetup, and edit if you build the
bonus) go through an endpoint layer that validates them on the server with the shared Zod schemas:
a Supabase Edge Function or a small TypeScript server, your choice, explained in your note.
Postgres functions are fine behind that layer, called by your endpoint code, but not as the
write endpoints themselves; SQL checks alone do not meet the Zod-validated requirement. Reads
(lists, my groups, detail, map data) may query Supabase directly with the member's session under
row-level security, or go through your endpoints. Sign-in uses Supabase Auth directly
(spec section 10).

Put the Zod schemas in one place that both the endpoints and the app import (for example a
shared folder or package). If the app imports from a folder outside its own, Metro may need that
folder added to `watchFolders` in `metro.config.js`. Use one Zod major version on both sides.
Edge Functions run on Deno, so plan how they import the shared schemas (for example an import
map or a relative import). A small Node TypeScript server is the simplest way to share one Zod
module with the app; Edge Functions work too but need the import planning above.

## 5. Submitting

See the workflow challenge brief for what to submit, and include your own run instructions (spec section
11). If anything here is ambiguous, state your assumption in your note and proceed.
