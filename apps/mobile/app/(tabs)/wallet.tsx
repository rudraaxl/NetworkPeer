import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import type { WalletBalance } from "@/lib/types";
import { colors, radii, shadow, spacing, typography } from "@/lib/theme";
import { EmptyState, InfoBanner, LoadingState, StatTile } from "@/components/ui";

function cents(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 100 : 0;
}

export default function WalletScreen() {
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.wallet();
      setBalances(result.balances);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load wallet");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const available = balances.reduce((sum, b) => sum + cents(b.availableBalanceCents), 0);
  const pending = balances.reduce((sum, b) => sum + cents(b.pendingEscrowCents), 0);
  const lifetime = balances.reduce((sum, b) => sum + cents(b.lifetimeEarningsCents), 0);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
      >
        <Text style={styles.kicker}>Earnings</Text>
        <Text style={styles.title}>Wallet</Text>
        <Text style={styles.subtitle}>Balances from completed and in-progress field work</Text>

        {loading ? (
          <LoadingState label="Loading wallet" />
        ) : balances.length > 0 || error === null ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>Available balance</Text>
              <Text style={styles.heroValue}>₹{available.toFixed(2)}</Text>
              <Text style={styles.heroHint}>Ready for payout after client approval and release</Text>
            </View>

            <View style={styles.row}>
              <StatTile label="Pending escrow" value={`₹${pending.toFixed(2)}`} icon="hourglass-outline" />
              <StatTile label="Lifetime earnings" value={`₹${lifetime.toFixed(2)}`} icon="trophy-outline" />
            </View>

            <InfoBanner
              tone="warning"
              icon="information-circle-outline"
              title="How payments work"
              body="Client funds stay in escrow while you complete evidence. The balance moves to available once the client approves your submission."
            />
          </>
        ) : (
          <EmptyState
            icon="cloud-offline-outline"
            title="Wallet unavailable"
            body={error ?? "We could not load your earnings right now."}
            actionLabel="Try again"
            onAction={() => { setLoading(true); load(); }}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: 32, gap: spacing.lg },
  kicker: { ...typography.label, color: colors.primaryMuted, textTransform: "uppercase" },
  title: { ...typography.display, marginTop: 2 },
  subtitle: { ...typography.body },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    padding: spacing.xxl,
    ...shadow,
  },
  heroLabel: { color: "#E9D5FF", fontSize: 13, fontWeight: "600" },
  heroValue: { color: "#fff", fontSize: 36, fontWeight: "800", marginTop: 8, letterSpacing: -0.8 },
  heroHint: { color: "#E9D5FF", fontSize: 13, marginTop: 8, lineHeight: 18 },
  row: { flexDirection: "row", gap: spacing.md },
});
