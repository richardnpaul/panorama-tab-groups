/**
 * Utility functions for Tab Groups Viewer
 * Pure functions with no state dependencies
 */
import type { NativeGroupColor } from '../ports/native-groups.js';

/**
 * Mathematical modulo operation
 * JavaScript's % operator doesn't behave like mathematical modulo for negative numbers
 * @param x - The dividend
 * @param n - The divisor
 * @returns The modulo result
 * @see https://stackoverflow.com/questions/4467539/javascript-modulo-gives-a-negative-result-for-negative-numbers
 */
export function mod(x: number, n: number): number {
  return ((x % n) + n) % n;
}

/**
 * Get a color for a tab group based on its ID
 * Cycles through available colors for visual distinction
 * @param groupId - The group ID
 * @returns Color name for the group
 */
export function getColorForGroupId(
  groupId: number,
): NativeGroupColor | undefined {
  const colors: readonly NativeGroupColor[] = [
    'grey',
    'blue',
    'red',
    'yellow',
    'green',
    'pink',
    'purple',
    'cyan',
    'orange',
  ];
  return colors[groupId % colors.length];
}

/**
 * Get the lowest positive integer group ID from an array of groups
 * Returns undefined if no positive ID groups exist
 * @param groups - Array of group objects
 * @returns Lowest positive ID or undefined
 */
export function getLowestPositiveGroupId(
  groups: readonly { id: unknown }[] | null | undefined,
): number | undefined {
  return groups
    ?.map((g) => g.id)
    .filter((id): id is number => typeof id === 'number' && id >= 0)
    .sort((a, b) => a - b)[0];
}
