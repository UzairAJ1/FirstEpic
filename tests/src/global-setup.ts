import { API_URL, FUNCTIONS_URL } from "./env.ts";

// Fail fast with a useful message instead of 40 confusing test failures.
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
}
