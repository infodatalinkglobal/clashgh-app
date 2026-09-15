import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  endpoints,
  pesewasToGhs,
  relativeTime,
  type GameType,
  type RegistrationView,
  type Tournament,
  type TournamentStatus,
} from '../services/api';
import { useAuth } from '../store/AuthContext';
import { Badge, Button, Screen } from '../components/ui';
import { colors, fontWeights, radius, spacing, typography } from '../theme';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const GAME_LABELS: Record<GameType, string> = {
  efootball: 'eFootball',
  fc_mobile: 'FC Mobile',
  codm: 'CODM',
  dls: 'DLS',
};

const FILTERS: { key: GameType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'efootball', label: 'eFootball' },
  { key: 'fc_mobile', label: 'FC Mobile' },
  { key: 'codm', label: 'CODM' },
  { key: 'dls', label: 'DLS' },
];

const STATUS_TONE: Record<TournamentStatus, 'green' | 'muted' | 'red' | 'gold'> = {
  open: 'green',
  full: 'muted',
  in_progress: 'gold',
  completed: 'muted',
  cancelled: 'red',
};

/**
 * Home & Lobby (Module 2B).
 * Browse tournaments, filter by game, entry-fee display, join button.
 * "Last updated" label + refresh on screen focus (agent.md §14).
 */
export function HomeScreen({ navigation }: Props) {
  const { profile } = useAuth();
  const [game, setGame] = useState<GameType | 'all'>('all');
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [registrations, setRegistrations] = useState<Record<string, RegistrationView | null>>({});
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (gameFilter: GameType | 'all') => {
      try {
        const { tournaments: list } = await endpoints.listTournaments({
          game: gameFilter === 'all' ? undefined : gameFilter,
          limit: 25,
        });
        setTournaments(list);
        // My registration state per visible tournament (open / in-progress only).
        const relevant = list.filter((t) => t.status === 'open' || t.status === 'in_progress');
        const entries = await Promise.all(
          relevant.map(async (t) => {
            try {
              const { registration } = await endpoints.myRegistration(t.id);
              return [t.id, registration] as const;
            } catch {
              return [t.id, null] as const;
            }
          }),
        );
        setRegistrations((prev) => {
          const next = { ...prev };
          for (const [id, reg] of entries) next[id] = reg;
          return next;
        });
        setUpdatedAt(new Date());
      } catch {
        // keep last data
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  // Refresh on focus (agent.md §14) + on mount.
  useFocusEffect(
    useCallback(() => {
      void load(game);
    }, [load, game]),
  );

  const onFilter = (g: GameType | 'all') => {
    setGame(g);
    setLoading(true);
    void load(g);
  };

  const renderCard = ({ item: t }: { item: Tournament }) => {
    const reg = registrations[t.id];
    const paid = t.paid_count + (t.status === 'full' ? 0 : 0);
    const spotsText =
      t.status === 'cancelled'
        ? 'Cancelled'
        : t.spots_left > 0
          ? `${t.spots_left} spot${t.spots_left === 1 ? '' : 's'} left`
          : 'Lobby full';
    return (
      <View style={styles.card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Badge label={GAME_LABELS[t.game]} tone="gold" />
            <Badge label={t.status.replace('_', ' ')} tone={STATUS_TONE[t.status]} />
          </View>
          <Text style={{ color: colors.gold, fontSize: typography.subheading, fontWeight: fontWeights.bold }}>
            {pesewasToGhs(t.entry_fee_pesewas)}
          </Text>
        </View>

        <Text style={styles.title} numberOfLines={2}>
          {t.title}
        </Text>

        <Text style={styles.meta}>
          Entry {pesewasToGhs(t.entry_fee_pesewas)} · {paid}/{t.max_players} paid · {spotsText}
        </Text>
        <Text style={styles.meta2}>
          1st {pesewasToGhs(t.prize_pool_pesewas ?? t.projection_if_full.first_prize_pesewas)} ·
          {' '}Runner-up {pesewasToGhs(t.projection_if_full.runnerup_prize_pesewas)}
        </Text>
        <Text style={styles.meta2}>
          Closes {relativeTime(t.closes_at)} · Starts {relativeTime(t.starts_at)}
        </Text>

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.xs }}>
          {t.status === 'cancelled' ? (
            <Badge label="Cancelled" tone="red" />
          ) : reg?.payment_status === 'paid' ? (
            <Badge label="You're in ✓" tone="green" />
          ) : reg?.payment_status === 'pending' ? (
            <Button
              label="Finish payment →"
              onPress={() =>
                navigation.navigate('Join', {
                  tournamentId: t.id,
                  resumeReference: reg.payment_reference,
                  resumeDeadline: reg.payment_deadline,
                })
              }
            />
          ) : t.can_join ? (
            <Button label="Join" onPress={() => navigation.navigate('Join', { tournamentId: t.id })} />
          ) : t.status === 'full' ? (
            <Badge label="Full" tone="muted" />
          ) : t.status === 'in_progress' ? (
            <Badge label="In progress" tone="gold" />
          ) : (
            <Badge label="Closed" tone="muted" />
          )}
        </View>
      </View>
    );
  };

  return (
    <Screen style={{ padding: 0, gap: 0 }}>
      <View style={{ padding: spacing.xl, paddingBottom: spacing.md }}>
        <Text style={styles.header}>Tournaments</Text>
        <Text style={styles.updated}>
          {updatedAt ? `Last updated ${updatedAt.toLocaleTimeString()}` : 'Loading…'}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.sm }}>
          {FILTERS.map((f) => (
            <FilterChip key={f.key} label={f.label} active={game === f.key} onPress={() => onFilter(f.key)} />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={tournaments}
        keyExtractor={(t) => t.id}
        renderItem={renderCard}
        contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.md, paddingBottom: spacing.xl, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(game);
            }}
            tintColor={colors.gold}
          />
        }
        ListEmptyComponent={
          loading ? (
            <Text style={styles.empty}>Loading tournaments…</Text>
          ) : (
            <Text style={styles.empty}>No tournaments in this list yet — check back soon.</Text>
          )
        }
      />
    </Screen>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: active ? colors.gold : colors.surfaceAlt,
        borderColor: active ? colors.gold : colors.border,
        borderWidth: 1,
        borderRadius: radius.pill,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text
        style={{
          color: active ? '#14100A' : colors.textMuted,
          fontSize: typography.caption,
          fontWeight: fontWeights.semibold,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: fontWeights.bold,
  },
  updated: {
    color: colors.textFaint,
    fontSize: typography.tiny,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: typography.subheading,
    fontWeight: fontWeights.semibold,
  },
  meta: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  meta2: {
    color: colors.textFaint,
    fontSize: typography.tiny,
  },
  empty: {
    color: colors.textMuted,
    fontSize: typography.body,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
});
