/**
 * Utility functions for Panorama Tab Groups
 * Pure functions with no state dependencies
 */

/**
 * Mathematical modulo operation
 * JavaScript's % operator doesn't behave like mathematical modulo for negative numbers
 * @param {number} x - The dividend
 * @param {number} n - The divisor
 * @returns {number} The modulo result
 * @see https://stackoverflow.com/questions/4467539/javascript-modulo-gives-a-negative-result-for-negative-numbers
 */
export function mod(x, n) {
  return ((x % n) + n) % n;
}

/**
 * Get a color for a tab group based on its ID
 * Cycles through available colors for visual distinction
 * @param {number} groupId - The group ID
 * @returns {string} Color name for the group
 */
export function getColorForGroupId(groupId) {
  const colors = [
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
 * @param {Array} groups - Array of group objects
 * @returns {number|undefined} Lowest positive ID or undefined
 */
export function getLowestPositiveGroupId(groups) {
  if (!groups || groups.length === 0) {
    return undefined;
  }

  const positiveIds = groups
    .map((g) => g.id)
    .filter((id) => typeof id === 'number' && id >= 0)
    .sort((a, b) => a - b);

  return positiveIds.length > 0 ? positiveIds[0] : undefined;
}
