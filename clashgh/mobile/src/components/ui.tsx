import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
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

/** Primary CTA: gold gradient with glow; scales on press. */
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
  const scale = useRef(new Animated.Value(1)).current;
  const isDisabled = disabled || busy;
  const fg = variant === 'primary' ? '#14100A' : variant === 'danger' ? '#fff' : colors.text;
  const press = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: Platform.OS !== 'web', speed: 40, bounciness: 6 }).start();

  const inner = busy ? (
    <ActivityIndicator color={fg} />
  ) : (
    <Text style={{ color: fg, fontSize: typography.body, fontWeight: fontWeights.bold, letterSpacing: 0.3 }}>{label}</Text>
  );

  return (
    <Animated.View style={[{ transform: [{ scale }], opacity: isDisabled ? 0.45 : 1 }, variant === 'primary' && !isDisabled && styles.glowGold, style]}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        disabled={isDisabled}
        onPressIn={() => press(0.97)}
        onPressOut={() => press(1)}
        style={[
          styles.button,
          variant === 'secondary' && { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderBright },
          variant === 'ghost' && { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
          variant === 'danger' && { backgroundColor: colors.red },
        ]}
      >
        {variant === 'primary' ? (
          <LinearGradient colors={['#FFD54A', '#FFC61A', '#F0A500']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: radius.md }]} />
        ) : null}
        {inner}
      </Pressable>
    </Animated.View>
  );
}

/** Glass card with subtle top highlight. */
export function Card({ children, style, accent }: { children: React.ReactNode; style?: ViewStyle; accent?: string }) {
  return (
    <View style={[styles.card, accent ? { borderLeftWidth: 3, borderLeftColor: accent } : null, style]}>
      <LinearGradient colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { borderRadius: radius.lg, height: 60 }]} pointerEvents="none" />
      {children}
    </View>
  );
}

/** Fade + rise on mount; `delay` staggers list items. */
export function FadeIn({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: ViewStyle }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [v, delay]);
  return (
    <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }, style]}>
      {children}
    </Animated.View>
  );
}

/** Pulsing dot for "live" states. */
export function LiveDot({ color = colors.red, size = 8 }: { color?: string; size?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 900, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(v, { toValue: 0, duration: 900, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={{ width: size * 2.5, height: size * 2.5, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: size * 2.5, height: size * 2.5, borderRadius: size * 2, backgroundColor: color, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }} />
      <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />
    </View>
  );
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

/** Live countdown to an ISO time — "02:14:09" or "Now". */
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

/** Burst of falling confetti (gold/cyan/green); runs once on mount. */
export function Confetti({ count = 40 }: { count?: number }) {
  const { width, height } = useWindowDimensions();
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => ({
    x: Math.random() * Math.min(width, WEB_MAX_WIDTH), delay: Math.random() * 500, size: 6 + Math.random() * 6,
    color: [colors.gold, colors.cyan, colors.green, '#fff'][i % 4], rot: Math.random() * 360, drift: (Math.random() - 0.5) * 120,
  })), [count, width]);
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(v, { toValue: 1, duration: 2600, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start(); }, [v]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p, i) => (
        <Animated.View key={i} style={{ position: 'absolute', left: p.x, top: -20, width: p.size, height: p.size * 0.6, backgroundColor: p.color, borderRadius: 2,
          opacity: v.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, height + 40] }) },
            { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
            { rotate: v.interpolate({ inputRange: [0, 1], outputRange: [`${p.rot}deg`, `${p.rot + 720}deg`] }) },
          ] }} />
      ))}
    </View>
  );
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
  glowGold: {
    shadowColor: colors.gold, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6,
    borderRadius: radius.md,
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
