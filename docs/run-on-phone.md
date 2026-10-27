# Run the app on an Android phone (USB) and mirror it with scrcpy

USB plus `adb reverse` lets the phone reach the local Supabase stack at
`127.0.0.1`, with no Wi-Fi or firewall setup. scrcpy mirrors the phone into a
window on the PC for screen recording.

## One-time setup

### Phone
1. Install **Expo Go** from the Play Store.
2. Settings → About phone → tap **Build number** 7 times to unlock Developer options.
3. Settings → System → Developer options → turn on **USB debugging**.
   (On Samsung or Xiaomi, search Settings for "USB debugging".)

### PC
4. Download `scrcpy-win64-<version>.zip` from
   https://github.com/Genymobile/scrcpy/releases (under "Assets").
5. Unzip it to `C:\tools\scrcpy`. The folder contains `scrcpy.exe` and `adb.exe`.
6. Add `C:\tools\scrcpy` to your PATH: Start → "Edit environment variables for your
   account" → select `Path` → Edit → New → `C:\tools\scrcpy` → OK.
7. Fully quit and reopen VS Code so new terminals see the PATH.

### Connect
8. Plug the phone in with a USB **data** cable.
9. On the phone, accept **"Allow USB debugging?"** and tick "Always allow from this computer".
10. Check the connection:
    ```
    adb devices
    ```
    You should see one line ending in `device`. If it says `unauthorized`, unlock the phone
    and accept the prompt. If nothing is listed, try another cable or USB port, and on the
    phone set the USB mode to "File transfer".

### App config
11. Create `apps/mobile/.env` (copy `.env.example`; the file is git-ignored) and set:
    ```
    EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
    ```
    Keep the `EXPO_PUBLIC_SUPABASE_ANON_KEY` line from `.env.example`.

## Every session (four terminals)

Start Docker Desktop first.

**Terminal 1: backend**
```
npx supabase start
npx supabase functions serve
```
Leave `functions serve` running.

**Terminal 2: USB tunnels.** Run this again whenever the phone is re-plugged:
```
adb reverse tcp:54321 tcp:54321
adb reverse tcp:8081 tcp:8081
```

**Terminal 3: the app**
```
cd apps\mobile
npx expo start --localhost --clear
```
When the QR code shows, press **`a`**. Expo Go opens on the phone and loads the app. The
first load takes a minute.

**Terminal 4: the mirror**
```
scrcpy --show-touches --stay-awake --max-size 1080 --window-title "Altair (Android)"
```
A window shows the phone screen live. You can click and type in it with the mouse and
keyboard too.

## Quick check
- Sign in as **Sam**, open "Saturday morning loop" → a **circle**. Tap RSVP → a **pin** at
  "North gate, Linden Park".
- Sign out, then sign in as **Taylor** → "You're not in any walking groups yet".
- Sign in as **Avery**, open "Saturday morning loop" → a **Cancel meetup** button. Sam
  doesn't see one.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Pressing `a` says no device found | `adb devices` must list the phone. Restart VS Code after the PATH change. |
| Expo Go: "Could not connect to development server" | Re-run the two `adb reverse` lines, then press `a` again. |
| App shows "Can't reach the server" or sign-in fails with a network error | Re-run `adb reverse tcp:54321 tcp:54321`. Check the `.env` URL is `127.0.0.1`, then restart Expo with `--clear`. |
| Changed `.env` but nothing changed | Expo bakes env values into the bundle: stop it and run `npx expo start --localhost --clear`. |
| Expo Go says the project's SDK is incompatible | Update Expo Go from the Play Store (the app uses SDK 58). |
| Map is blank or grey | Check the phone has internet (map tiles come from Google). Make sure Google Play services is up to date. |
| scrcpy closes immediately | Unlock the phone. Check `adb devices` shows only one device. |

## Recording tips
- Turn on **Do Not Disturb** on the phone so notifications don't appear in the mirror.
- Put VS Code (code or terminal) on the left two-thirds and the scrcpy window on the right.
- Record the **whole screen**, not one window.
