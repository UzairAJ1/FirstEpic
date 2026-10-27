# Altair: group meetups slice

First Epic workflow challenge (Senior Full-Stack, Altair). This repo has:
- the database and its access rules (Supabase/Postgres)
- one write endpoint (a Supabase Edge Function)
- one shared Zod contract
- access tests
- the React Native app (Expo, Android)

It also has both bonus parts: meetup editing, and a live-map sample.

- **Note** (decisions, what I directed and caught, pushback): [docs/NOTE.md](docs/NOTE.md)
- **Decision records:** [docs/decisions.md](docs/decisions.md)
- **Live map latency / battery / load-test note:** [docs/live-map-note.md](docs/live-map-note.md)
- **AI session logs:** [ai-logs/](ai-logs/)

## Repository layout

```
supabase/migrations/   starter schema + timestamped migrations (tables, RLS/grants, write functions, bonus)
supabase/seed.sql      seed PART 1 (accounts, groups) + PART 2 adapted to this schema
supabase/functions/    meetups Edge Function: POST/PATCH/DELETE writes, validated with the shared contract
packages/contracts/    the shared Zod schemas, imported by the Edge Function (Deno) and the app (Metro)
tests/                 Vitest access tests against the local stack (real Auth sessions, real API)
apps/mobile/           Expo SDK 58 app (Expo Router, react-native-maps)
tools/live-sim.ts      bonus (b): simulated live positions + load probe
```

## Prerequisites

- **Node.js 24** (tested with 24.21; `tools/live-sim.ts` relies on Node's built-in TypeScript support).
- **Docker Desktop**, running.
- To run the app, either:
  - an **Android phone** with **Expo Go** from the Play Store, or
  - an **Android emulator** with Google Play (Android Studio), which also has Expo Go.

  Only Android was tested.

No accounts, API keys or map keys are needed. Everything runs locally.

## Run it from a clean checkout

All commands run from the repo root unless a step says otherwise. Keep one terminal per
long-running process.

### 1. Install

```
npm install
```

This also installs the Supabase CLI as a dev dependency, so use `npx supabase ...`.

### 2. Database: migrations and seed

```
npx supabase start
npx supabase db reset
```

`start` pulls the Docker images on first run (a few minutes) and boots the stack. `db reset`
applies every migration in `supabase/migrations/` in order, then `supabase/seed.sql`:
- PART 1: the seed accounts and groups
- PART 2: the three reference meetups and their RSVPs

Run `db reset` any time you want a clean database. `npx supabase status` prints the URLs and the
local keys. Studio, the database UI, is at http://127.0.0.1:54323.

### 3. Write endpoint (terminal A, keep it open)

```
npx supabase functions serve
```

It serves `http://127.0.0.1:54321/functions/v1/meetups`. If you restart the stack, start this
again.

### 4. Tests (terminal B)

```
npm test
```

63 tests run against the local stack. Each signs in as a seed persona through Supabase Auth
and calls the real API. If a database reset has just finished, the first run waits a few seconds
for Realtime. The tests are re-runnable without a reset.

| File | Proves |
|---|---|
| `read-access.test.ts` | The four roles on "Saturday morning loop":<br>• Taylor, the outsider, reads nothing: meetup, attendees, meeting point or groups.<br>• Sam, no RSVP, gets an approximate area ≥ 300 m, not centered on the exact point, with no place name.<br>• Jordan (RSVP'd) and Avery (creator) see the exact point.<br>• Signed-out requests are denied. |
| `multi-group.test.ts` | Riley (both groups): map data follows Riley's own status per meetup, and an RSVP to one meetup unlocks nothing else. Single-group members see only their own group. |
| `writes.test.ts` | Future-start rule; strict input; **creator-only cancel**; **no RSVP to a cancelled meetup** or a started one (set up as DB owner); cancelling is final; withdraw after cancel; RSVP is idempotent |
| `bypass.test.ts` | Direct table writes and direct calls to the write functions with a user session are denied. `home_lat`/`home_lng` are unreadable for everyone. |
| `edit.test.ts` | Bonus (a): creator-only edit, future-start re-check, no edit after cancel, new approximate area when the point moves |
| `live.test.ts` | Bonus (b): only group members can join or send on the group's private Realtime channel |
| *(every file)* | Every response body is scanned for all seeded home coordinates |

### 5. The app (terminal C)

Create the app's env file. It holds the local API URL and the public local anon key. Never put
the service role key in it.

```
# PowerShell
Copy-Item apps/mobile/.env.example apps/mobile/.env
# macOS / Linux
cp apps/mobile/.env.example apps/mobile/.env
```

Set `EXPO_PUBLIC_SUPABASE_URL` in `apps/mobile/.env` to match how the device reaches your
computer:

| Device | URL | Extra step |
|---|---|---|
| Phone over Wi-Fi | `http://<your computer's LAN IP>:54321`, e.g. `http://192.168.1.20:54321` | Same Wi-Fi network. On Windows: set the network profile to **Private**, and allow inbound TCP 8081 (Expo) and 54321 (Supabase). See below. |
| Phone over USB | `http://127.0.0.1:54321` | `adb reverse tcp:54321 tcp:54321` and `adb reverse tcp:8081 tcp:8081` (details in [docs/run-on-phone.md](docs/run-on-phone.md)) |
| Android emulator | `http://10.0.2.2:54321` | none |

Then start the app:

```
cd apps/mobile
npx expo start --clear
```

- **Phone:** in **Expo Go**, use *Scan QR code* (inside Expo Go, not the camera app) on the
  terminal's QR code, or *Enter URL manually*: `exp://<LAN IP>:8081`.
- **Emulator:** press `a`.

Use `--clear` whenever you change `.env`; Expo bakes those values in at bundle time.

**Sign in** with a seed account. The sign-in screen has one-tap buttons for them. Every
password is `altair-fixture-pass`.

| Account | Role |
|---|---|
| `avery@example.test` | Maple Street Walkers; creator of "Saturday morning loop" |
| `jordan@example.test` | Maple; RSVP'd to Saturday; creator of "Weeknight short walk" |
| `sam@example.test` | Maple; no RSVPs |
| `riley@example.test` | **Both groups**; RSVP'd to Saturday only |
| `morgan@example.test` | Riverside Loop Walkers; creator of "Riverside sunrise walk" |
| `casey@example.test` | Riverside; RSVP'd to Riverside sunrise walk |
| `quinn@example.test` | Riverside; no RSVPs |
| `taylor@example.test` | **Outsider**: in no group |

**Quick walkthrough:**
1. Sign in as **Sam** and open *Saturday morning loop*. The map shows an approximate **circle**
   and no place name.
2. Tap **RSVP**. The map becomes a **pin** at *North gate, Linden Park*.
3. Sign in as **Taylor**. You get the "not in any walking groups" empty state.
4. Sign in as **Avery**. *Saturday morning loop* shows **Edit** and **Cancel**, which only the
   creator sees.

### 6. Bonus (b): live map (terminal D, optional)

```
npm run live-sim
```

This broadcasts 25 **simulated** walkers on Maple Street Walkers' private channel. In the app,
as a Maple member such as Sam, tap **Live map (demo)**. Zoom in to see culling: "known" stays the
same while "rendered" drops. As Morgan, a non-member, the screen says you're not a member.

To run it as a load probe:
```
npm run live-sim -- --walkers 80 --clients 1 --measure --duration 30
```
Local Realtime caps a project at 100 events/s. See [docs/live-map-note.md](docs/live-map-note.md)
before going higher.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker: command not found` from `npx supabase ...` (Windows) | Docker Desktop's `resources\bin` isn't on this terminal's PATH. Open a new terminal; if VS Code started before Docker was installed, sign out and back in to Windows. |
| App: "Can't reach the server", or Expo Go can't connect | On the phone's browser, open `http://<LAN IP>:8081/status`. If it doesn't load: check the same Wi-Fi, a Private network profile, and the firewall rule below. |
| Writes fail (create, RSVP, cancel) but lists load | `npx supabase functions serve` isn't running. Start it (step 3). |
| Live map stays "Connecting…" | Realtime starts a few seconds after the rest of the stack; wait and reopen the screen. |
| `.env` change has no effect | Restart Expo with `--clear`. |

Windows firewall rule for Wi-Fi testing (admin PowerShell; Private networks only):
```
New-NetFirewallRule -DisplayName "Altair dev (Expo 8081 + Supabase 54321)" -Direction Inbound -Protocol TCP -LocalPort 8081,54321 -Action Allow -Profile Private
```

## Endpoints

All writes go through one Edge Function. The user is taken from the `Authorization: Bearer`
token, never from the body. Bodies are validated with the shared schemas in
`packages/contracts`.

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/functions/v1/meetups` | `CreateMeetupInput` | 201 `{ id }` |
| PATCH | `/functions/v1/meetups/:id` | `UpdateMeetupInput` (bonus) | 200 `{ id }` |
| POST | `/functions/v1/meetups/:id/cancel` | none | 200 `{ id, status: "cancelled" }` |
| POST | `/functions/v1/meetups/:id/rsvp` | none | 200 `{ meetupId, attending: true }` |
| DELETE | `/functions/v1/meetups/:id/rsvp` | none | 200 `{ meetupId, attending: false }` |

Errors use `{ error: { code, message, issues? } }`:
- 400 `invalid_input`
- 401 `unauthorized`
- 403 `forbidden` (a member who isn't the creator)
- 404 `not_found` (also returned to outsiders, so existence never leaks)
- 409 `conflict` (cancelled or started)

Reads go straight to `meetup_details`, `meetup_attendees` and `groups` with the user's session,
under RLS.
