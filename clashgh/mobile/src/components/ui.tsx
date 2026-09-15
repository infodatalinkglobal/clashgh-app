import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { colors, fontWeights, radius, spacing, typography } from '../theme';

/** Base screen wrapper: dark background, safe padding, scroll-free. */
export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.screen, style]}>{children}</View>
  );
}

/** Brand mark — a gold "clash" chevron + wordmark. Hand-rolled (no icon deps). */
export function Logo({ size = 44 }: { size?: number }) {
  return (
    <View style={{ alignItems: 'center', gap: spacing.sm }}>
      <View style={{ width: size, height: size * 0.72, flexDirection: 'row', alignItems: 'flex-end', gap: 3 }}>
        <View style={{ flex: 1, height: '70%', backgroundColor: colors.gold, borderRadius: radius.sm }} />
        <View style={{ flex: 1, height: '100%', backgroundColor: colors.gold, borderRadius: radius.sm }} />
        <View style={{ flex: 1, height: '52%', backgroundColor: colors.goldDim, borderRadius: radius.sm }} />
      </View>
      <Text style={{ color: colors.text, fontSize: typography.heading, fontWeight: fontWeights.bold, letterSpacing: 2 }}>
        CLASH<Text style={{ color: colors.gold }}>GH</Text>
      </Text>
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const bg =
    variant === 'primary'
      ? colors.gold
      : variant === 'secondary'
        ? colors.surfaceAlt
        : variant === 'danger'
          ? colors.red
          : 'transparent';
  const fg = variant === 'primary' ? '#14100A' : variant === 'danger' ? '#fff' : colors.text;
  const isDisabled = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          opacity: isDisabled ? 0.45 : pressed ? 0.85 : 1,
          borderWidth: variant === 'secondary' || variant === 'ghost' ? 1 : 0,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontSize: typography.body, fontWeight: fontWeights.semibold }}>{label}</Text>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize = 'none',
  keyboardType = 'default',
  secure = false,
  error,
  hint,
  onSubmit,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'email-address' | 'number-pad' | 'phone-pad';
  secure?: boolean;
  error?: string | null;
  hint?: string | null;
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        secureTextEntry={secure}
        autoFocus={autoFocus}
        onSubmitEditing={onSubmit}
        style={[
          styles.input,
          { borderColor: error ? colors.red : colors.border },
        ]}
      />
      {error ? (
        <Text style={styles.fieldError}>{error}</Text>
      ) : hint ? (
        <Text style={styles.fieldHint}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Badge({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'gold' | 'green' | 'red' }) {
  const map = {
    muted: { bg: colors.surfaceAlt, fg: colors.textMuted },
    gold: { bg: 'rgba(245,179,1,0.15)', fg: colors.gold },
    green: { bg: 'rgba(46,158,91,0.15)', fg: colors.green },
    red: { bg: 'rgba(229,72,77,0.15)', fg: colors.red },
  } as const;
  const t = map[tone];
  return (
    <View style={{ backgroundColor: t.bg, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
      <Text style={{ color: t.fg, fontSize: typography.tiny, fontWeight: fontWeights.semibold }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  button: {
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  label: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: fontWeights.medium,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: typography.body,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    minHeight: 48,
  },
  fieldError: { color: colors.red, fontSize: typography.tiny },
  fieldHint: { color: colors.textFaint, fontSize: typography.tiny },
});
