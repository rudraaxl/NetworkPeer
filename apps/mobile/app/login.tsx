import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { colors, radii, spacing, typography } from "@/lib/theme";

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("91") ? `+${digits}` : `+91${digits}`;
}

function isValidPhone(raw: string): boolean {
  return raw.replace(/\D/g, "").length >= 10;
}

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function requestOtp() {
    const normalized = toE164(phone);
    if (!isValidPhone(phone)) {
      setError("Enter a valid 10-digit phone number.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.requestOtp(normalized);
      setOtpSent(true);
      setCooldown(60);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    const normalized = toE164(phone);
    if (!isValidPhone(phone)) {
      setError("Enter a valid 10-digit phone number.");
      return;
    }
    if (otp.trim().length < 4) {
      setError("Enter the OTP you received.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await login(normalized, otp.trim());
      try {
        await api.grantConsent("LOCATION");
        await api.grantConsent("EVIDENCE");
      } catch {
        // Consent recording is best-effort after successful authentication.
      }
      router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid OTP");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Pressable onPress={() => router.replace("/welcome")} hitSlop={12}>
            <Text style={styles.back}>‹</Text>
          </Pressable>
          <Text style={styles.title}>Worker sign in</Text>
          <Text style={styles.subtitle}>Sign in with your phone number. No password needed.</Text>
        </View>

        <Text style={styles.label}>Phone number</Text>
        <TextInput
          style={styles.input}
          placeholder="+91 98765 43210"
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          autoCapitalize="none"
          value={phone}
          onChangeText={setPhone}
        />

        {otpSent && (
          <>
            <Text style={styles.label}>OTP code</Text>
            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              value={otp}
              onChangeText={setOtp}
              maxLength={6}
            />
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.buttonPrimary, loading && styles.buttonDisabled]} disabled={loading} onPress={otpSent ? verifyOtp : requestOtp}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonTextPrimary}>{otpSent ? "Verify and continue" : "Send OTP"}</Text>
          )}
        </Pressable>

        {otpSent && (
          <View style={styles.links}>
            <Pressable onPress={() => setOtpSent(false)}>
              <Text style={styles.link}>Change phone number</Text>
            </Pressable>
            <Pressable disabled={cooldown > 0 || loading} onPress={requestOtp}>
              <Text style={[styles.link, cooldown > 0 && styles.linkDisabled]}>
                {cooldown > 0 ? `Resend OTP in ${cooldown}s` : "Resend OTP"}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: "center", padding: 24 },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 24, borderWidth: 1, borderColor: colors.border, ...{ shadowColor: "#0F172A", shadowOpacity: 0.05, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 3 } },
  header: { marginBottom: spacing.xl },
  back: { fontSize: 28, color: colors.textSecondary, marginBottom: spacing.sm, marginLeft: -4 },
  title: { ...typography.title },
  subtitle: { ...typography.body, marginTop: 4 },
  label: { fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: 14, fontSize: 16, color: colors.text, marginBottom: spacing.lg, backgroundColor: colors.surfaceMuted },
  buttonPrimary: { backgroundColor: colors.primary, borderRadius: radii.md, paddingVertical: 15, alignItems: "center", ...{ shadowColor: colors.primary, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 4 } },
  buttonDisabled: { opacity: 0.6 },
  buttonTextPrimary: { color: "#fff", fontSize: 16, fontWeight: "700" },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.md },
  links: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.md },
  link: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  linkDisabled: { color: colors.textMuted },
});
