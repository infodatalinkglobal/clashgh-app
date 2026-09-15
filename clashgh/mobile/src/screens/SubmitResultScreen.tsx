import React from 'react';
import { Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Screen } from '../components/ui';
import { colors, typography } from '../theme';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'SubmitResult'>;

/** Score Submit — Module 2E (placeholder until built). */
export function SubmitResultScreen({ navigation }: Props) {
  return (
    <Screen>
      <Button label="‹ Back" variant="ghost" onPress={() => navigation.goBack()} style={{ alignSelf: 'flex-start' }} />
      <Text style={{ color: colors.text, fontSize: typography.heading }}>Submit result</Text>
      <Text style={{ color: colors.textMuted }}>Coming in Module 2E.</Text>
    </Screen>
  );
}
