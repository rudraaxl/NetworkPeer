import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { button, colors, radii, shadow, spacing, statusTone, typography } from "@/lib/theme";

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1 }}>
        <Text style={typography.title}>{title}</Text>
        {subtitle ? <Text style={[typography.body, { marginTop: 4 }]}>{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const container = variant === "secondary" ? button.secondary : variant === "ghost" ? button.ghost : button.primary;
  const text = variant === "secondary" ? button.textSecondary : variant === "ghost" ? button.textGhost : button.textPrimary;
  return (
    <Pressable
      style={[container, (disabled || loading) && styles.disabled]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading) }}
    >
      {loading ? <ActivityIndicator color={variant === "primary" ? "#fff" : colors.primary} /> : <Text style={text}>{label}</Text>}
    </Pressable>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone = statusTone[status] ?? { color: colors.textMuted, background: colors.surfaceMuted, label: status.replaceAll("_", " ") };
  return (
    <View style={[styles.pill, { backgroundColor: tone.background }]}>
      <Text style={[styles.pillText, { color: tone.color }]}>{tone.label}</Text>
    </View>
  );
}

export function MetaChip({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.metaChip}>
      <Ionicons name={icon} size={13} color={colors.textMuted} />
      <Text style={styles.metaChipText}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {actionLabel && onAction ? (
        <View style={{ marginTop: spacing.lg, width: "100%", maxWidth: 220 }}>
          <PrimaryButton label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

export function InfoBanner({
  tone = "info",
  icon,
  title,
  body,
}: {
  tone?: "info" | "warning" | "success" | "danger";
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  const map = {
    info: { bg: colors.infoSoft, border: colors.infoBorder, color: colors.info },
    warning: { bg: colors.warningSoft, border: colors.warningBorder, color: colors.warning },
    success: { bg: colors.successSoft, border: colors.successBorder, color: colors.success },
    danger: { bg: colors.dangerSoft, border: colors.dangerBorder, color: colors.danger },
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: map.bg, borderColor: map.border }]}>
      <Ionicons name={icon} size={18} color={map.color} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.bannerTitle, { color: map.color }]}>{title}</Text>
        <Text style={[styles.bannerBody, { color: map.color }]}>{body}</Text>
      </View>
    </View>
  );
}

export function StatTile({ label, value, icon }: { label: string; value: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.statTile}>
      {icon ? <Ionicons name={icon} size={16} color={colors.primaryMuted} /> : null}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, marginBottom: spacing.lg },
  sectionAction: { color: colors.primary, fontSize: 13, fontWeight: "700", marginTop: 4 },
  disabled: { opacity: 0.55 },
  pill: { borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metaChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  empty: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, paddingVertical: 48 },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: radii.full,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  emptyTitle: { ...typography.heading, textAlign: "center" },
  emptyBody: { ...typography.body, textAlign: "center", marginTop: 6, maxWidth: 280 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, backgroundColor: colors.background },
  loadingText: { ...typography.caption, color: colors.textSecondary },
  banner: {
    flexDirection: "row",
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  bannerTitle: { fontSize: 13, fontWeight: "700" },
  bannerBody: { fontSize: 12, lineHeight: 18, marginTop: 3, opacity: 0.9 },
  statTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: 6,
    ...shadow,
  },
  statValue: { fontSize: 18, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  statLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
});
