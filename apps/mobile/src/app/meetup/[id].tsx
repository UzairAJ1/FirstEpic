import { router, Stack, useLocalSearchParams } from "expo-router";
import { Alert, ScrollView, Text, View } from "react-native";
import { MeetupMap } from "@/components/MeetupMap";
import { Badge, Button, Empty, ErrorState, FieldError, formatWhen, Loading, styles } from "@/components/ui";
import { useAttendees, useCancelMeetup, useMeetup, useSetRsvp } from "@/lib/queries";

export default function MeetupDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const meetup = useMeetup(id);
  const attendees = useAttendees(id);
  const rsvp = useSetRsvp(id);
  const cancel = useCancelMeetup(id);

  if (meetup.isPending) return <Loading />;
  if (meetup.isError) return <ErrorState message={meetup.error.message} onRetry={() => meetup.refetch()} />;
  // RLS returns nothing for outsiders, so this covers "gone" and "not yours" alike.
  if (!meetup.data) return <Empty title="This meetup isn't available" />;

  const m = meetup.data;
  const cancelled = m.status === "cancelled";
  const started = Date.parse(m.startsAt) <= Date.now();
  const canRsvp = !m.hasRsvp && !cancelled && !started;
  const actionError = (rsvp.error ?? cancel.error)?.message;

  function confirmCancel() {
    Alert.alert("Cancel this meetup?", "Members will see it as cancelled. This can't be undone.", [
      { text: "Keep it", style: "cancel" },
      { text: "Cancel meetup", style: "destructive", onPress: () => cancel.mutate() },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad}>
      <Stack.Screen options={{ title: m.title }} />

      <Text style={[styles.heading, cancelled && { textDecorationLine: "line-through" }]}>{m.title}</Text>
      <Text style={styles.text}>{formatWhen(m.startsAt)}</Text>
      <View style={styles.row}>
        {cancelled ? <Badge label="Cancelled" tone="danger" /> : <Badge label={started ? "Started" : "Scheduled"} />}
        {m.isCreator && <Badge label="Hosting" />}
        {m.hasRsvp && <Badge label="Going" tone="success" />}
        {m.creatorName && <Text style={styles.muted}>Posted by {m.creatorName}</Text>}
      </View>

      {/* The map shows what the server sent: exact pin or approximate area. */}
      <MeetupMap point={m.meetingPoint} />
      {m.meetingPoint.kind === "exact" ? (
        <Text style={styles.title}>{m.meetingPoint.name}</Text>
      ) : (
        <Text style={styles.muted}>
          Approximate area (about {m.meetingPoint.radiusM} m around the circle's center).
          {cancelled ? "" : " RSVP to see the exact meeting point."}
        </Text>
      )}

      <FieldError message={actionError} />
      {canRsvp && <Button label="RSVP" onPress={() => rsvp.mutate(true)} busy={rsvp.isPending} />}
      {m.hasRsvp && (
        <Button label="Withdraw RSVP" variant="secondary" onPress={() => rsvp.mutate(false)} busy={rsvp.isPending} />
      )}
      {m.isCreator && !cancelled && (
        <>
          <Button
            label="Edit meetup"
            variant="secondary"
            onPress={() => router.push({ pathname: "/edit/[id]", params: { id: m.id } })}
          />
          <Button label="Cancel meetup" variant="danger" onPress={confirmCancel} busy={cancel.isPending} />
        </>
      )}

      <Text style={[styles.title, { marginTop: 8 }]}>Going ({m.attendeeCount})</Text>
      {attendees.isPending ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : attendees.isError ? (
        <Text style={styles.muted}>Couldn't load attendees.</Text>
      ) : attendees.data.length === 0 ? (
        <Text style={styles.muted}>No one yet.</Text>
      ) : (
        attendees.data.map((a) => (
          <Text key={a.userId} style={styles.text}>
            {a.displayName}
          </Text>
        ))
      )}
    </ScrollView>
  );
}
