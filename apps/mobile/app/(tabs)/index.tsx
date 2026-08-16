import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { getCurrentLocation } from "@/lib/location";
import { useAuth } from "@/lib/auth";
import type { WorkerJobSummary } from "@/lib/types";
import { colors, radii, shadow, spacing, typography } from "@/lib/theme";
import { EmptyState, LoadingState, MetaChip } from "@/components/ui";

export default function JobsScreen() {
  const router = useRouter();
  const { worker } = useAuth();
  const [jobs, setJobs] = useState<WorkerJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstName = worker?.fullName?.trim().split(/\s+/)[0] ?? "";
  const displayName = firstName.length > 0 ? firstName : "there";
  const avatarInitial = firstName.charAt(0).toUpperCase() || (worker?.phone.replace(/\D/g, "").slice(-2).charAt(0) ?? "N");

  const load = useCallback(async () => {
    try {
      const location = await getCurrentLocation();
      if (!location) throw new Error("Location access is needed to find nearby jobs. Enable it in Settings and try again.");
      await api.updateLocation(location.latitude, location.longitude);
      const result = await api.nearbyJobs();
      setJobs(result.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingState label="Finding nearby jobs" />;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={jobs.length ? styles.list : styles.emptyList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.topRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.kicker}>Worker dashboard</Text>
                <Text style={styles.greeting}>Hi, {displayName}</Text>
                <Text style={styles.subtitle}>
                  {error ? "We could not refresh jobs right now." : jobs.length > 0 ? `${jobs.length} nearby jobs available` : "No nearby work yet. Pull to refresh."}
                </Text>
              </View>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{avatarInitial}</Text>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={error ? "cloud-offline-outline" : "briefcase-outline"}
            title={error ? "Could not load jobs" : "No jobs nearby"}
            body={error ?? "New field jobs will appear here when available."}
            actionLabel={error ? "Try again" : undefined}
            onAction={error ? () => { setLoading(true); load(); } : undefined}
          />
        }
        renderItem={({ item }) => <JobCard job={item} onPress={() => router.push(`/job/${item.id}`)} />}
      />
    </SafeAreaView>
  );
}

function distanceBandLabel(band: WorkerJobSummary["distance_band"]): string {
  switch (band) {
    case "UNDER_1_KM": return "Under 1 km";
    case "1_TO_5_KM": return "1–5 km";
    case "5_TO_20_KM": return "5–20 km";
    case "20KM_PLUS": return "20+ km";
  }
}

function JobCard({ job, onPress }: { job: WorkerJobSummary; onPress: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open job ${job.title}`}>
      <View style={styles.cardTop}>
        <View style={styles.badgeRow}>
          <View style={styles.categoryBadge}><Text style={styles.categoryText}>{job.category}</Text></View>
        </View>
        <Text style={styles.pay}>₹{(job.budget_cents / 100).toFixed(0)}</Text>
      </View>
      <Text style={styles.jobTitle}>{job.title}</Text>
      <Text style={styles.objective} numberOfLines={2}>{job.description}</Text>
      <View style={styles.metaRow}>
        <MetaChip icon="location-outline" label={distanceBandLabel(job.distance_band)} />
        {job.scheduled_at && <MetaChip icon="calendar-outline" label={new Date(job.scheduled_at).toLocaleDateString()} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { paddingBottom: 28 },
  emptyList: { flexGrow: 1, paddingBottom: 28 },
  headerBlock: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.md },
  topRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  kicker: { ...typography.label, color: colors.primaryMuted, textTransform: "uppercase" },
  greeting: { ...typography.display, marginTop: 4 },
  subtitle: { ...typography.body, marginTop: 4 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primary, fontSize: 18, fontWeight: "800" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    ...shadow,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, flex: 1 },
  categoryBadge: { backgroundColor: colors.primarySoft, borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 5 },
  categoryText: { color: colors.primary, fontSize: 11, fontWeight: "700" },
  pay: { fontSize: 22, fontWeight: "800", color: colors.text, letterSpacing: -0.4 },
  jobTitle: { ...typography.heading, marginTop: 12 },
  objective: { ...typography.body, marginTop: 8 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
});
