import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, API_URL, FUNCTIONS_URL } from "./env.ts";
import { groups, PASSWORD, users } from "./fixtures.ts";

// Fail fast with a useful message instead of 60 confusing test failures.
export default async function () {
  const check = async (url: string, hint: string) => {
    try {
      await fetch(url, { method: "OPTIONS" });
    } catch {
      throw new Error(`Cannot reach ${url}. ${hint}`);
    }
  };
  await check(`${API_URL}/rest/v1/`, "Start the stack: npx supabase start");
  await check(FUNCTIONS_URL, "Serve the endpoint: npx supabase functions serve");
  await waitForRealtime();
}

// `supabase db reset` restarts the containers, and Realtime takes a few
// seconds before it can authorize private channels again. Wait for a
// member's join to succeed rather than failing the live tests.
async function waitForRealtime() {
  const db = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await db.auth.signInWithPassword({ email: users.sam.email, password: PASSWORD });
  await db.realtime.setAuth(data.session!.access_token);

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const channel = db.channel(`live:group:${groups.maple}`, { config: { private: true } });
    const status = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("TIMEOUT"), 5_000);
      channel.subscribe((s) => {
        if (s !== "SUBSCRIBED" && s !== "CHANNEL_ERROR" && s !== "TIMED_OUT") return;
        clearTimeout(timer);
        resolve(s);
      });
    });
    await db.removeChannel(channel);
    if (status === "SUBSCRIBED") {
      await db.removeAllChannels();
      return;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("Realtime didn't become ready within 45 s. Check `npx supabase status`.");
}
