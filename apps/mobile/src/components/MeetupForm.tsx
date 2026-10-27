import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import MapView, { Marker, type LatLng } from "react-native-maps";
import { Button, FieldError, formatWhen, styles } from "./ui";

// Where the picker map opens when there's no point yet: the fictional town's
// reference point (seed data). Deliberately NOT derived from the member's
// home location, which this feature must never use (spec section 8).
const TOWN_CENTER = { latitude: 40.0, longitude: -100.0 };

export type MeetupFormValues = {
  title: string;
  startsAt: Date;
  placeName: string;
  point?: LatLng;
};

export type FormErrors = Record<string, string>;

/** Turn Zod / API issues into per-field messages for this form. */
export function issuesToErrors(issues: { path: string | PropertyKey[]; message: string }[]): FormErrors {
  const errors: FormErrors = {};
  for (const issue of issues) {
    const path = Array.isArray(issue.path) ? issue.path.join(".") : String(issue.path);
    if (path === "meetingPoint.lat" || path === "meetingPoint.lng") {
      errors["meetingPoint.point"] ??= "Tap the map to place the meeting point";
    } else {
      errors[path] ??= issue.message;
    }
  }
  return errors;
}

type Props = {
  initial: MeetupFormValues;
  submitLabel: string;
  busy: boolean;
  errors: FormErrors;
  formError?: string;
  onSubmit: (values: MeetupFormValues) => void;
};

export function MeetupForm({ initial, submitLabel, busy, errors, formError, onSubmit }: Props) {
  const [title, setTitle] = useState(initial.title);
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [placeName, setPlaceName] = useState(initial.placeName);
  const [point, setPoint] = useState(initial.point);

  function pickAndroid(mode: "date" | "time") {
    DateTimePickerAndroid.open({
      value: startsAt,
      mode,
      minimumDate: mode === "date" ? new Date() : undefined,
      onValueChange: (_event, date) => setStartsAt(date),
    });
  }

  const center = point ?? TOWN_CENTER;

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
        initialRegion={{ ...center, latitudeDelta: point ? 0.01 : 0.05, longitudeDelta: point ? 0.01 : 0.05 }}
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
      <Button
        label={submitLabel}
        busy={busy}
        onPress={() => onSubmit({ title, startsAt, placeName, point })}
      />
    </ScrollView>
  );
}

const local = StyleSheet.create({
  map: { width: "100%", height: 240, borderRadius: 10 },
});
