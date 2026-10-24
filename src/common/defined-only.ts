/**
 * Keeps only the keys the client actually sent. Validated DTO instances carry every
 * declared field (as `undefined` when absent), and `Object.assign` would copy those
 * over values already saved on the entity.
 */
export function definedOnly<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) as Partial<T>;
}
