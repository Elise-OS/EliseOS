export type Brand<T, B extends string> = T & { readonly __brand: B };
export type HomeId = Brand<string, 'HomeId'>;
export type ResidentId = Brand<string, 'ResidentId'>;

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export function nowIso(): string {
  return new Date().toISOString();
}
