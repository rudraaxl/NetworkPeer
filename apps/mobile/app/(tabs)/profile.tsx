import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import type { WalletBalance } from "@/lib/types";
import { colors, radii, shadow, spacing, typography } from "@/lib/theme";
import { InfoBanner, StatTile } from "@/components/ui";

function cents(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 100 : 0;
}

export default function ProfileScreen() {
  const { worker, logout } = useAuth();
  const router = useRouter();
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState<string | null>(null);

  const loadWallet = useCallback(async () => {
    setWalletLoading(true);
    try {
      const result = await api.wallet();
      setBalances(result.balances);
      setWalletError(null);
    } catch (e) {
      setWalletError(e instanceof Error ? e.message : "Could not load wallet summary.");
    } finally {
      setWalletLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  const available = balances.reduce((sum, b) => sum + cents(b.availableBalanceCents), 0);
  const pending = balances.reduce((sum, b) => sum + cents(b.pendingEscrowCents), 0);
  const lifetime = balances.reduce((sum, b) => sum + cents(b.lifetimeEarningsCents), 0);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.kicker}>Worker profile</Text>
              <Text style={styles.heroTitle}>Your account</Text>
            </View>
          </View>

          <View style={styles.avatar}><Text style={styles.avatarText}>N</Text></View>
          <Text style={styles.name}>Worker</Text>
          <Text style={styles.phone}>{worker?.phone ?? ""}</Text>
          <View style={styles.verifiedRow}>
            <Ionicons name="checkmark-circle" size={14} color="#A7F3D0" />
            <Text style={styles.verifiedText}>Phone verified</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <StatTile label="Lifetime" value={walletLoading ? "…" : `₹${lifetime.toFixed(0)}`} />
          <StatTile label="Pending" value={walletLoading ? "…" : `₹${pending.toFixed(0)}`} />
          <StatTile label="Available" value={walletLoading ? "…" : `₹${available.toFixed(0)}`} />
        </View>

        {walletError ? (
          <Pressable style={styles.walletError} onPress={loadWallet}>
            <Ionicons name="refresh-outline" size={16} color={colors.danger} />
            <Text style={styles.walletErrorText}>Wallet summary unavailable. Tap to retry.</Text>
          </Pressable>
        ) : null}

        <InfoBanner
          tone="info"
          icon="camera-outline"
          title="Evidence stays job-bound"
          body="Photos, video, and audio are captured live with GPS and timestamps. Gallery upload stays disabled on active jobs."
        />

        <View style={styles.privacyCard}>
          <Text style={styles.privacyTitle}>Privacy & data</Text>
          <Text style={styles.privacyBody}>Withdraw consent or request account data deletion.</Text>
          <Pressable style={styles.privacyButton} onPress={() => { void api.withdrawConsent("LOCATION"); }}>
            <Text style={styles.privacyButtonText}>Withdraw location consent</Text>
          </Pressable>
          <Pressable style={[styles.privacyButton, styles.deleteButton]} onPress={() => { void api.deleteAccount(); }}>
            <Text style={styles.deleteButtonText}>Delete account data</Text>
          </Pressable>
        </View>

        <Pressable style={styles.logoutButton} onPress={async () => { await logout(); router.replace("/welcome"); }}>
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 32 },
  hero: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: 48,
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
  },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  kicker: { color: "#DDD6FE", fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  heroTitle: { color: "#fff", fontSize: 28, fontWeight: "800", marginTop: 4 },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: radii.full,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.55)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xl,
    alignSelf: "center",
  },
  avatarText: { color: "#fff", fontSize: 30, fontWeight: "800" },
  name: { color: "#fff", fontSize: 22, fontWeight: "800", textAlign: "center", marginTop: spacing.md },
  phone: { color: "#E9D5FF", fontSize: 13, textAlign: "center", marginTop: 4 },
  verifiedRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 8 },
  verifiedText: { color: "#D1FAE5", fontSize: 13, fontWeight: "600" },
  statsRow: { flexDirection: "row", gap: spacing.sm, marginHorizontal: spacing.xl, marginTop: -28 },
  walletError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    padding: 12,
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.md,
  },
  walletErrorText: { flex: 1, color: colors.danger, fontSize: 12, fontWeight: "600" },
  privacyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow,
  },
  privacyTitle: { ...typography.heading },
  privacyBody: { ...typography.body },
  privacyButton: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  privacyButtonText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  deleteButton: { backgroundColor: colors.dangerSoft },
  deleteButtonText: { color: colors.danger, fontSize: 14, fontWeight: "600" },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.md,
    marginHorizontal: spacing.xl,
    marginTop: spacing.lg,
    paddingVertical: 14,
  },
  logoutText: { color: colors.danger, fontSize: 15, fontWeight: "700" },
});
