import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, radii, spacing } from "@/lib/theme";

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.top}>
        <View style={styles.logo}>
          <Ionicons name="location" size={28} color="#fff" />
        </View>
        <Text style={styles.brand}>NetworkPeers</Text>
        <Text style={styles.tagline}>Earn by completing on-site tasks. Every task is verified with photo, video and GPS evidence.</Text>
      </View>

      <View style={styles.bottom}>
        <View style={styles.featureRow}>
          <View style={styles.featureIcon}>
            <Ionicons name="camera-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.featureTextWrap}>
            <Text style={styles.featureTitle}>Capture verified evidence</Text>
            <Text style={styles.featureText}>Photos, videos and audio stamped with location and time.</Text>
          </View>
        </View>
        <View style={styles.featureRow}>
          <View style={styles.featureIcon}>
            <Ionicons name="wallet-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.featureTextWrap}>
            <Text style={styles.featureTitle}>Get paid to your wallet</Text>
            <Text style={styles.featureText}>Escrow-backed payments release when clients approve.</Text>
          </View>
        </View>
        <View style={styles.featureRow}>
          <View style={styles.featureIcon}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.featureTextWrap}>
            <Text style={styles.featureTitle}>Trusted by field teams</Text>
            <Text style={styles.featureText}>Fraud-safe by design with tamper-resistant captures.</Text>
          </View>
        </View>

        <View style={styles.buttons}>
          <Pressable style={[styles.buttonPrimary, { opacity: 1 }]} onPress={() => router.push({ pathname: "/login", params: { mode: "signup" } })}>
            <Text style={styles.buttonTextPrimary}>Create account</Text>
          </Pressable>
          <Pressable style={styles.buttonSecondary} onPress={() => router.push({ pathname: "/login", params: { mode: "login" } })}>
            <Text style={styles.buttonTextSecondary}>I already have an account</Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>By continuing you agree to our Terms of Service and Privacy Policy.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  top: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  logo: { width: 64, height: 64, borderRadius: radii.xl, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg, ...{ shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 6 } },
  brand: { fontSize: 32, fontWeight: "800", color: colors.text, letterSpacing: -0.8 },
  tagline: { fontSize: 15, color: colors.textSecondary, textAlign: "center", marginTop: spacing.md, lineHeight: 22 },
  bottom: { paddingHorizontal: 24, paddingBottom: 24 },
  featureRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  featureIcon: { width: 40, height: 40, borderRadius: radii.full, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginRight: spacing.md },
  featureTextWrap: { flex: 1 },
  featureTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  featureText: { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 17 },
  buttons: { marginTop: spacing.sm },
  buttonPrimary: { backgroundColor: colors.primary, borderRadius: radii.md, paddingVertical: 15, alignItems: "center", marginBottom: spacing.md, ...{ shadowColor: colors.primary, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 4 } },
  buttonSecondary: { borderRadius: radii.md, paddingVertical: 15, alignItems: "center", borderWidth: 1, borderColor: colors.primaryBorder, backgroundColor: colors.primarySoft },
  buttonTextPrimary: { color: "#fff", fontSize: 16, fontWeight: "700" },
  buttonTextSecondary: { color: colors.primaryDark, fontSize: 16, fontWeight: "700" },
  footer: { fontSize: 11, color: colors.textMuted, textAlign: "center", marginTop: spacing.lg, lineHeight: 15 },
});
