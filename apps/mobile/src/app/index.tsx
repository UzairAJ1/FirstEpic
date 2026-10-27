import type { Meetup } from "@altair/contracts";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Badge, Button, Empty, ErrorState, formatWhen, Loading, styles } from "@/components/ui";
import { useGroupMeetups, useMyGroups } from "@/lib/queries";
import { supabase } from "@/lib/supabase";

export default function MeetupList() {
  const groups = useMyGroups();
  const [picked, setPicked] = useState<string>();
  const groupId = picked ?? groups.data?.[0]?.id;
  const meetups = useGroupMeetups(groupId);

  const header = (
    <Stack.Screen
      options={{
        headerRight: () => (
          <Pressable onPress={() => supabase.auth.signOut()} hitSlop={8}>
            <Text style={styles.label}>Sign out</Text>
          </Pressable>
        ),
      }}
    />
  );

  if (groups.isPending) return <>{header}<Loading label="Loading your groups…" /></>;
  if (groups.isError) {
    return <>{header}<ErrorState message={groups.error.message} onRetry={() => groups.refetch()} /></>;
  }
  if (groups.data.length === 0) {
    return (
      <>
        {header}
        <Empty title="You're not in any walking groups yet">
          <Text style={[styles.muted, styles.centerText]}>
            Meetups appear here once you've joined a group.
          </Text>
        </Empty>
      </>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      <View style={[styles.pad, { paddingBottom: 0 }]}>
        {/* Group picker: fed by the "my groups" query, first group by default. */}
        <View style={styles.row}>
          {groups.data.map((g) => (
            <Pressable
              key={g.id}
              onPress={() => setPicked(g.id)}
              style={[styles.badge, { paddingVertical: 6, paddingHorizontal: 12 }, g.id === groupId && { backgroundColor: "#dbe7f3" }]}
            >
              <Text style={styles.label}>{g.name}</Text>
            </Pressable>
          ))}
        </View>
        <Button
          label="New meetup"
          onPress={() => router.push({ pathname: "/create", params: { groupId: groupId! } })}
        />
      </View>

      {meetups.isPending ? (
        <Loading label="Loading meetups…" />
      ) : meetups.isError ? (
        <ErrorState message={meetups.error.message} onRetry={() => meetups.refetch()} />
      ) : (
        <FlatList
          data={meetups.data}
          keyExtractor={(m) => m.id}
          contentContainerStyle={[styles.pad, meetups.data.length === 0 && { flex: 1 }]}
          refreshControl={<RefreshControl refreshing={meetups.isRefetching} onRefresh={() => void meetups.refetch()} />}
          ListEmptyComponent={
            <Empty title="No meetups yet">
              <Text style={styles.muted}>Be the first to post a walk for this group.</Text>
            </Empty>
          }
          renderItem={({ item }) => <MeetupRow meetup={item} />}
        />
      )}
    </View>
  );
}

function MeetupRow({ meetup }: { meetup: Meetup }) {
  const cancelled = meetup.status === "cancelled";
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }, cancelled && { opacity: 0.6 }]}
      onPress={() => router.push({ pathname: "/meetup/[id]", params: { id: meetup.id } })}
    >
      <Text style={[styles.title, cancelled && { textDecorationLine: "line-through" }]}>{meetup.title}</Text>
      <Text style={styles.muted}>{formatWhen(meetup.startsAt)}</Text>
      <View style={styles.row}>
        {cancelled && <Badge label="Cancelled" tone="danger" />}
        {meetup.isCreator && <Badge label="Hosting" />}
        {meetup.hasRsvp && <Badge label="Going" tone="success" />}
        <Text style={styles.muted}>
          {meetup.attendeeCount} going
        </Text>
      </View>
    </Pressable>
  );
}
