import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Web only: give each screen its own browser-tab title. Native ignores it.
 * Format: "<screen> | ClashGH" so the tab never reads as a generic app.
 */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const prev = document.title;
    document.title = title ? `${title} | ClashGH` : 'ClashGH app: tournaments, matches and wallet';
    return () => {
      document.title = prev;
    };
  }, [title]);
}
