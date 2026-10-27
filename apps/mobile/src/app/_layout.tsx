import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Loading } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

function RootStack() {
  const { session, loading } = useAuth();
  const userId = session?.user.id;

  // Never show one account's cached data to the next account on the same
  // device: drop the whole cache whenever the signed-in user changes.
  useEffect(() => {
    queryClient.clear();
  }, [userId]);

  if (loading) return <Loading />;

  return (
    <Stack>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="index" options={{ title: "Meetups" }} />
        <Stack.Screen name="create" options={{ title: "New meetup" }} />
        <Stack.Screen name="meetup/[id]" options={{ title: "Meetup" }} />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" options={{ title: "Sign in" }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootStack />
      </AuthProvider>
    </QueryClientProvider>
  );
}
