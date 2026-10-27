// Bonus (b): live map work sample. Animated avatars from broadcast positions
// on the group's PRIVATE Realtime channel (members only, enforced by RLS on
// realtime.messages). Positions come from tools/live-sim.ts: simulated
// walkers, never real device or home locations. See docs/live-map-note.md.
import { LivePosition } from "@altair/contracts";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { styles as ui } from "@/components/ui";
import { supabase } from "@/lib/supabase";

const RENDER_FPS = 15; // smooth enough for walking speed; 4x fewer frames than 60
const INTERP_DELAY_MS = 1200; // render ~1 update interval behind, so there's a "next" sample to lerp to
const MAX_EXTRAPOLATE_MS = 500; // if updates stall, coast briefly, then hold
const STALE_MS = 10_000; // forget walkers we haven't heard from
const CULL_MARGIN = 0.15; // keep a 15% border so markers don't pop at the edge
const MAX_TRACKS = 500; // a flood of fake ids can't grow memory without bound

type Sample = { t: number; lat: number; lng: number };
type Track = { name: string; samples: Sample[]; lastHeard: number };
type Rendered = { id: string; name: string; latitude: number; longitude: number };

const TOWN: Region = { latitude: 40.0, longitude: -100.0, latitudeDelta: 0.06, longitudeDelta: 0.06 };

function positionAt(samples: Sample[], t: number): { lat: number; lng: number } {
  const last = samples[samples.length - 1];
  if (t >= last.t) {
    const prev = samples[samples.length - 2];
    if (!prev) return last;
    const ahead = Math.min(t - last.t, MAX_EXTRAPOLATE_MS);
    const k = ahead / (last.t - prev.t || 1);
    return { lat: last.lat + (last.lat - prev.lat) * k, lng: last.lng + (last.lng - prev.lng) * k };
  }
  for (let i = samples.length - 1; i > 0; i--) {
    const a = samples[i - 1];
    const b = samples[i];
    if (t >= a.t) {
      const k = (t - a.t) / (b.t - a.t || 1);
      return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k };
    }
  }
  return samples[0];
}

function inView(lat: number, lng: number, r: Region) {
  const halfLat = (r.latitudeDelta / 2) * (1 + CULL_MARGIN);
  const halfLng = (r.longitudeDelta / 2) * (1 + CULL_MARGIN);
  return Math.abs(lat - r.latitude) <= halfLat && Math.abs(lng - r.longitude) <= halfLng;
}

export default function LiveMap() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const tracks = useRef(new Map<string, Track>());
  const region = useRef<Region>(TOWN);
  const received = useRef(0);
  const [status, setStatus] = useState<"connecting" | "live" | "denied" | "paused">("connecting");
  const [rendered, setRendered] = useState<Rendered[]>([]);
  const [hud, setHud] = useState({ known: 0, perSec: 0 });
  const [appActive, setAppActive] = useState(AppState.currentState === "active");

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setAppActive(s === "active"));
    return () => sub.remove();
  }, []);

  // Subscribe and animate only while this screen is focused and the app is
  // in the foreground: no socket traffic or frames in the background.
  useFocusEffect(
    useCallback(() => {
      if (!appActive) {
        setStatus("paused");
        return;
      }
      let cancelled = false;
      setStatus("connecting");
      const channel = supabase.channel(`live:group:${groupId}`, { config: { private: true } });
      channel.on("broadcast", { event: "pos" }, ({ payload }) => {
        received.current++;
        // Any member can post here: validate with the shared contract, drop the rest.
        const parsed = LivePosition.safeParse(payload);
        if (!parsed.success) return;
        const pos = parsed.data;
        if (!tracks.current.has(pos.id) && tracks.current.size >= MAX_TRACKS) return;

        // Stamp with local arrival time: no dependence on the sender's clock.
        const now = Date.now();
        const track: Track = tracks.current.get(pos.id) ?? { name: pos.name, samples: [], lastHeard: now };
        track.samples.push({ t: now, lat: pos.lat, lng: pos.lng });
        if (track.samples.length > 3) track.samples.shift();
        track.lastHeard = now;
        tracks.current.set(pos.id, track);
      });
      supabase.realtime.setAuth().then(() => {
        if (cancelled) return;
        channel.subscribe((s) => {
          if (s === "SUBSCRIBED") setStatus("live");
          else if (s === "CHANNEL_ERROR") setStatus("denied");
        });
      });

      const frame = setInterval(() => {
        const now = Date.now();
        const renderAt = now - INTERP_DELAY_MS;
        const next: Rendered[] = [];
        for (const [id, track] of tracks.current) {
          if (now - track.lastHeard > STALE_MS) {
            tracks.current.delete(id);
            continue;
          }
          // Cull on the last known point first (cheap), interpolate only what's visible.
          const last = track.samples[track.samples.length - 1];
          if (!inView(last.lat, last.lng, region.current)) continue;
          const p = positionAt(track.samples, renderAt);
          next.push({ id, name: track.name, latitude: p.lat, longitude: p.lng });
        }
        setRendered(next);
      }, 1000 / RENDER_FPS);

      const counter = setInterval(() => {
        setHud({ known: tracks.current.size, perSec: received.current });
        received.current = 0;
      }, 1000);

      return () => {
        cancelled = true;
        clearInterval(frame);
        clearInterval(counter);
        supabase.removeChannel(channel);
        tracks.current.clear();
      };
    }, [groupId, appActive]),
  );

  return (
    <View style={ui.screen}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={TOWN}
        showsUserLocation={false}
        toolbarEnabled={false}
        onRegionChangeComplete={(r) => (region.current = r)}
      >
        {rendered.map((w) => (
          <Avatar key={w.id} name={w.name} latitude={w.latitude} longitude={w.longitude} />
        ))}
      </MapView>
      <View style={local.hud}>
        <Text style={local.hudText}>
          {status === "live" ? "● Live" : status === "denied" ? "Not a member of this group" : status === "paused" ? "Paused" : "Connecting…"}
        </Text>
        <Text style={local.hudText}>
          {hud.known} walkers known · {rendered.length} rendered (in view) · {hud.perSec} msg/s
        </Text>
        <Text style={local.hudHint}>Simulated walkers (tools/live-sim.ts). Zoom in to see culling.</Text>
      </View>
    </View>
  );
}

// Custom marker views are rasterized on Android; keep tracksViewChanges on
// just long enough to draw once, then off so moving the marker doesn't
// re-render the view every frame.
function Avatar({ name, latitude, longitude }: { name: string; latitude: number; longitude: number }) {
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracking(false), 500);
    return () => clearTimeout(t);
  }, []);
  const initials = name.replace(/^Walker\s*/, "W").slice(0, 3);
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  return (
    <Marker coordinate={{ latitude, longitude }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracking}>
      <View style={[local.avatar, { backgroundColor: `hsl(${hue}, 55%, 45%)` }]}>
        <Text style={local.avatarText}>{initials}</Text>
      </View>
    </Marker>
  );
}

const local = StyleSheet.create({
  hud: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 12,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 10,
    padding: 10,
    gap: 2,
  },
  hudText: { fontSize: 14, fontWeight: "600", color: "#1d232b" },
  hudHint: { fontSize: 12, color: "#5b6673" },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  avatarText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
