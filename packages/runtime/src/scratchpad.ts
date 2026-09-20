/**
 * Run-scoped key/value store. `read` and `compose` nodes write to it; `act` slots
 * read from it via "$.key.path" references.
 *
 * Keys are normalised because nodes write them inconsistently — `into: "summary"` and
 * `into: "$.summary"` name the same thing, and comparing them raw is what made the
 * plan benchmark report coherent plans as broken.
 */
export function scratchKey(raw: string): string {
  return raw.replace(/^\$\./, "").split(".")[0] ?? raw;
}

export class Scratchpad {
  private readonly data = new Map<string, unknown>();

  constructor(seed: Record<string, unknown> = {}) {
    for (const [k, v] of Object.entries(seed)) this.data.set(scratchKey(k), v);
  }

  set(rawKey: string, value: unknown): void {
    this.data.set(scratchKey(rawKey), value);
  }

  has(rawKey: string): boolean {
    return this.data.has(scratchKey(rawKey));
  }

  /** Resolve "$.a.b.c", or undefined if any hop is missing. */
  resolve(ref: string): unknown {
    const path = ref.replace(/^\$\./, "").split(".");
    const root = path.shift();
    if (root === undefined) return undefined;
    let current: unknown = this.data.get(root);
    for (const hop of path) {
      if (current === null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[hop];
    }
    return current;
  }

  get(rawKey: string): unknown {
    return this.data.get(scratchKey(rawKey));
  }

  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.data);
  }
}
