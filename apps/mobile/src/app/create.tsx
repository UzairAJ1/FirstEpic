import { CreateMeetupInput } from "@altair/contracts";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MapView, { Marker, type LatLng } from "react-native-maps";
import { Button, FieldError, formatWhen, styles } from "@/components/ui";
import { ApiRequestError } from "@/lib/api";
import { useCreateMeetup } from "@/lib/queries";

// Where the picker map opens: the fictional town's reference point (seed
// data). Deliberately NOT derived from the member's home location, which
// this feature must never use (spec section 8).
const TOWN_CENTER = { latitude: 40.0, longitude: -100.0, latitudeDelta: 0.05, longitudeDelta: 0.05 };

function tomorrowAt8() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d;
}

type Errors = Record<string, string>;

export default function CreateMeetup() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const create = useCreateMeetup();

  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState(tomorrowAt8);
  const [placeName, setPlaceName] = useState("");
  const [point, setPoint] = useState<LatLng>();
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();

  function pickAndroid(mode: "date" | "time") {
    DateTimePickerAndroid.open({
      value: startsAt,
      mode,
      minimumDate: mode === "date" ? new Date() : undefined,
      onValueChange: (_event, date) => setStartsAt(date),
    });
  }

  async function submit() {
    setFormError(undefined);
    // Same schema the server validates with: catch mistakes before the
    // round trip. The server still re-validates (and checks membership).
    const parsed = CreateMeetupInput.safeParse({
      groupId,
      title,
      startsAt: startsAt.toISOString(),
      meetingPoint: { name: placeName, lat: point?.latitude, lng: point?.longitude },
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        next[key.startsWith("meetingPoint.l") ? "meetingPoint.point" : key] ??= issue.message;
      }
      if (next["meetingPoint.point"]) next["meetingPoint.point"] = "Tap the map to place the meeting point";
      setErrors(next);
      return;
    }
    setErrors({});

    try {
      const { id } = await create.mutateAsync(parsed.data);
      router.replace({ pathname: "/meetup/[id]", params: { id } });
    } catch (e) {
      // Show the server's answer, field by field where it gives one.
      if (e instanceof ApiRequestError) {
        const fromServer: Errors = {};
        for (const i of e.issues) fromServer[i.path] = i.message;
        setErrors(fromServer);
        setFormError(e.message);
      } else {
        setFormError("Something went wrong");
      }
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Title</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={80} placeholder="Saturday morning loop" />
      <FieldError message={errors.title} />

      <Text style={styles.label}>Starts</Text>
      {Platform.OS === "android" ? (
        <View style={styles.row}>
          <Text style={styles.text}>{formatWhen(startsAt.toISOString())}</Text>
          <Button label="Date" variant="secondary" onPress={() => pickAndroid("date")} />
          <Button label="Time" variant="secondary" onPress={() => pickAndroid("time")} />
        </View>
      ) : (
        <DateTimePicker
          value={startsAt}
          mode="datetime"
          minimumDate={new Date()}
          onValueChange={(_event, date) => setStartsAt(date)}
        />
      )}
      <FieldError message={errors.startsAt} />

      <Text style={styles.label}>Meeting point name</Text>
      <TextInput
        style={styles.input}
        value={placeName}
        onChangeText={setPlaceName}
        maxLength={120}
        placeholder="Fountain plaza, Town Green"
      />
      <FieldError message={errors["meetingPoint.name"]} />

      <Text style={styles.label}>Meeting point (tap the map; use a public place)</Text>
      <MapView
        style={local.map}
        initialRegion={TOWN_CENTER}
        showsUserLocation={false}
        onPress={(e) => setPoint(e.nativeEvent.coordinate)}
      >
        {point && <Marker coordinate={point} />}
      </MapView>
      <Text style={styles.muted}>
        {point ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}` : "No point picked yet"}
      </Text>
      <FieldError message={errors["meetingPoint.point"]} />

      <FieldError message={formError} />
      <Button label="Create meetup" onPress={submit} busy={create.isPending} />
    </ScrollView>
  );
}

const local = StyleSheet.create({
  map: { width: "100%", height: 240, borderRadius: 10 },
});
