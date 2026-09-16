import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Animated, Easing, Platform, useWindowDimensions } from 'react-native';
import { colors, eyebrow, fontWeights, radius, spacing, typography } from '../theme';

/** On the web the app is a phone-width column centred on wide screens. */
export const WEB_MAX_WIDTH = 480;

/** Base screen wrapper: dark background, safe padding, scroll-free. */
export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const { width } = useWindowDimensions();
  const framed = Platform.OS === 'web' && width > WEB_MAX_WIDTH + 40;
  if (!framed) return <View style={[styles.screen, style]}>{children}</View>;
  return (
    <View style={styles.webBackdrop}>
      <View style={[styles.screen, styles.webFrame, style]}>{children}</View>
    </View>
  );
}

/** Brand mark: a gold "clash" chevron + wordmark. Hand-rolled (no icon deps). */
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

/** Flat button. Primary = solid gold, no glow; press = slight dim. */
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
  const isDisabled = disabled || busy;
  const fg = variant === 'primary' ? '#141414' : variant === 'danger' ? '#fff' : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: colors.gold },
        variant === 'secondary' && { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderBright },
        variant === 'ghost' && { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
        variant === 'danger' && { backgroundColor: colors.red },
        { opacity: isDisabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: typography.body, fontWeight: fontWeights.semibold }}>{label}</Text>}
    </Pressable>
  );
}

/** Flat card; optional 3px left accent for identity (game colour). */
export function Card({ children, style, accent }: { children: React.ReactNode; style?: ViewStyle; accent?: string }) {
  return <View style={[styles.card, accent ? { borderLeftWidth: 3, borderLeftColor: accent } : null, style]}>{children}</View>;
}

/** Square game monogram tile (replaces artwork). */
export function GameTile({ code, accent, size = 40 }: { code: string; accent: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: accent, fontSize: size * 0.36, fontWeight: fontWeights.bold, letterSpacing: 0.5 }}>{code}</Text>
    </View>
  );
}

/** Fade + rise on mount; `delay` staggers list items. */
export function FadeIn({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: ViewStyle }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 220, delay: Math.min(delay, 120), easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [v, delay]);
  return (
    <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }, style]}>
      {children}
    </Animated.View>
  );
}

/** Status dot (static). */
export function LiveDot({ color = colors.red, size = 8 }: { color?: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color, marginHorizontal: 4 }} />;
}

/** Shimmering placeholder block. */
export function Skeleton({ height = 16, width = '100%' as ViewStyle['width'], radius: r = radius.md, style }: { height?: number; width?: ViewStyle['width']; radius?: number; style?: ViewStyle }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 800, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(v, { toValue: 0, duration: 800, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[{ height, width, borderRadius: r, backgroundColor: colors.surfaceAlt, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }, style]} />;
}

/** Live countdown to an ISO time: "02:14:09" or "Now". */
export function Countdown({ to, style, prefix = '' }: { to: string; style?: StyleProp<TextStyle>; prefix?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const diff = Math.max(0, Math.floor((new Date(to).getTime() - now) / 1000));
  if (diff === 0) return <Text style={style}>{prefix}Now</Text>;
  const d = Math.floor(diff / 86400), h = Math.floor((diff % 86400) / 3600), m = Math.floor((diff % 3600) / 60), s = diff % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const txt = d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}`;
  return <Text style={[{ fontVariant: ['tabular-nums'] }, style]}>{prefix}{txt}</Text>;
}

/** Removed for a calmer product feel; kept as a no-op so call sites compile. */
export function Confetti(_: { count?: number }) {
  return null;
}

/** Small uppercase tracked label. */
export function Eyebrow({ children, color = colors.textMuted, style }: { children: React.ReactNode; color?: string; style?: StyleProp<TextStyle> }) {
  return <Text style={[eyebrow, { color }, style]}>{children}</Text>;
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
  multiline = false,
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
  multiline?: boolean;
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
        multiline={multiline}
        onSubmitEditing={onSubmit}
        style={[
          styles.input,
          { borderColor: error ? colors.red : colors.border },
          multiline && { minHeight: 88, textAlignVertical: 'top', paddingTop: spacing.md },
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
  webBackdrop: {
    flex: 1,
    backgroundColor: '#07090C',
    alignItems: 'center',
  },
  webFrame: {
    width: '100%',
    maxWidth: WEB_MAX_WIDTH,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    overflow: 'hidden',
  },
  button: {
    overflow: 'hidden',
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
