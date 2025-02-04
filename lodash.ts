import { PackageScripts, type ProjectManifest } from '@pnpm/types'

/**
 * Creates a new object with the specified properties omitted.
 */
export function omit(keys: string[], obj: Record<string, unknown> | ProjectManifest): PackageScripts {
  const result = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key) && !keys.includes(key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Checks if the given value is empty.
 */
export function isEmpty(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }
  return false;
}
/**
 * Maps each value in an object using an async function and returns a new object.
 */
export async function pMapValues<T>(fn: Function, obj: T): Promise<T> {
  const entries = Object.entries(obj);
  const mappedEntries = await Promise.all(
    entries.map(async ([key, value]) => [key, await fn(value, key)])
  );
  return Object.fromEntries(mappedEntries);
}
