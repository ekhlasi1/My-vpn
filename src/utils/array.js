/**
 * Checks if an array contains a specific value
 * @param arr - Array to search
 * @param value - Value to find
 * @returns True if value is found in array
 */
export function contains(arr, value) {
  return arr.includes(value)
}

/**
 * Filters out empty strings from an array
 * @param arr - Array of strings
 * @returns Array with empty strings removed
 */
export function filterEmpty(arr) {
  return arr.filter((item) => item !== '')
}

/**
 * Splits a string by separator and filters empty values
 * @param str - String to split
 * @param separator - Separator character
 * @returns Array of non-empty strings
 */
export function splitAndFilter(str, separator) {
  return filterEmpty(str.split(separator))
}