import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

export const colors = {
  bg: "#ffffff",
  text: "#1d232b",
  muted: "#5b6673",
  line: "#d9dee4",
  primary: "#2f5d8a",
  danger: "#b3261e",
  success: "#2e7d32",
  badge: "#eef2f6",
};

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={[styles.muted, styles.centerText]}>{message}</Text>
      {onRetry && <Button label="Try again" onPress={onRetry} variant="secondary" />}
    </View>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  busy?: boolean;
};

export function Button({ label, onPress, variant = "primary", disabled, busy }: ButtonProps) {
  const filled = variant !== "secondary";
  const tint = variant === "danger" ? colors.danger : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        filled ? { backgroundColor: tint } : { borderColor: tint, borderWidth: 1 },
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={filled ? "#fff" : tint} />
      ) : (
        <Text style={[styles.buttonLabel, { color: filled ? "#fff" : tint }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "danger" | "success" }) {
  const color = tone === "danger" ? colors.danger : tone === "success" ? colors.success : colors.muted;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeLabel, { color }]}>{label}</Text>
    </View>
  );
}

export function FieldError({ message }: { message?: string }) {
  return message ? <Text style={styles.fieldError}>{message}</Text> : null;
}

export const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  centerText: { textAlign: "center" },
  title: { fontSize: 18, fontWeight: "600", color: colors.text },
  heading: { fontSize: 22, fontWeight: "700", color: colors.text },
  text: { fontSize: 16, color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  label: { fontSize: 14, fontWeight: "600", color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  button: {
    minHeight: 46,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" },
  badgeLabel: { fontSize: 12, fontWeight: "600" },
  fieldError: { color: colors.danger, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 14, gap: 6 },
});
