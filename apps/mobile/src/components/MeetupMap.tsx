import type { MeetingPointView } from "@altair/contracts";
import { StyleSheet } from "react-native";
import MapView, { Circle, Marker } from "react-native-maps";
import { colors } from "./ui";

const M_PER_DEG = 111_320;

// Renders exactly what the server allowed this member to see: a pin for the
// exact point, or the stored approximate circle. There is nothing else to
// hide here; the exact coordinates simply aren't in an approximate payload.
// No user or home location is shown (showsUserLocation stays off).
export function MeetupMap({ point }: { point: MeetingPointView }) {
  const lat = point.kind === "exact" ? point.lat : point.centerLat;
  const lng = point.kind === "exact" ? point.lng : point.centerLng;
  // Exact: street level. Approximate: frame the whole circle with margin.
  const spanM = point.kind === "exact" ? 600 : point.radiusM * 2.6;
  const region = {
    latitude: lat,
    longitude: lng,
    latitudeDelta: spanM / M_PER_DEG,
    longitudeDelta: spanM / (M_PER_DEG * Math.cos((lat * Math.PI) / 180)),
  };

  return (
    <MapView
      // Remount when the view changes (e.g. after RSVP) so the camera moves.
      key={`${point.kind}:${lat}:${lng}`}
      style={styles.map}
      initialRegion={region}
      showsUserLocation={false}
      toolbarEnabled={false}
    >
      {point.kind === "exact" ? (
        <Marker coordinate={{ latitude: point.lat, longitude: point.lng }} title={point.name} />
      ) : (
        <Circle
          center={{ latitude: point.centerLat, longitude: point.centerLng }}
          radius={point.radiusM}
          strokeColor={colors.primary}
          strokeWidth={2}
          fillColor="rgba(47, 93, 138, 0.18)"
        />
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { width: "100%", height: 260, borderRadius: 10 },
});
