import React from 'react';
import { Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Screen } from '../components/ui';
import { colors, typography } from '../theme';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Match'>;

/** Match Room — Module 2D (placeholder until built). */
export function MatchScreen({ navigation, route }: Props) {
  return (
    <Screen>
      <Button label="‹ Back" variant="ghost" onPress={() => navigation.goBack()} style={{ alignSelf: 'flex-start' }} />
      <Text style={{ color: colors.text, fontSize: typography.heading }}>Match room</Text>
      <Text style={{ color: colors.textMuted }}>Coming in Module 2D. Match {route.params.matchId}</Text>
    </Screen>
  );
}
