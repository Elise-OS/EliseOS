import { requireNativeViewManager } from 'expo-modules-core';
import type { ViewProps } from 'react-native';

const NativeAppleLiquidGlass = requireNativeViewManager<ViewProps>('EliseAppleLiquidGlass');

export function AppleLiquidGlassBackground(props: ViewProps) {
  return <NativeAppleLiquidGlass {...props} pointerEvents="none" />;
}
