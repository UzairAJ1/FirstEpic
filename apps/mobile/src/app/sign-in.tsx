import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Button, FieldError, styles } from "@/components/ui";
import { supabase } from "@/lib/supabase";

// Seed accounts (spec section 13), as one-tap shortcuts for testing and the
// demo. They only fill the form; sign-in still goes through Supabase Auth.
const SEED_ACCOUNTS = [
  ["Avery", "creator"],
  ["Jordan", "RSVP'd"],
  ["Sam", "no RSVP"],
  ["Riley", "both groups"],
  ["Morgan", "Riverside creator"],
  ["Taylor", "outsider"],
] as const;
const SEED_PASSWORD = "altair-fixture-pass";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError(undefined);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Walking group meetups</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="sam@example.test"
        />
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
        />
        <FieldError message={error} />
        <Button label="Sign in" onPress={signIn} busy={busy} disabled={!email || !password} />

        <Text style={[styles.muted, { marginTop: 16 }]}>Seed accounts</Text>
        <View style={styles.row}>
          {SEED_ACCOUNTS.map(([name, role]) => (
            <Pressable
              key={name}
              style={styles.card}
              onPress={() => {
                setEmail(`${name.toLowerCase()}@example.test`);
                setPassword(SEED_PASSWORD);
              }}
            >
              <Text style={styles.label}>{name}</Text>
              <Text style={styles.muted}>{role}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
