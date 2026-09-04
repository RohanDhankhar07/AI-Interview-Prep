/** Ids are stable within a kit: we never renumber, we only ever mint unused ones. */
export function nextId(prefix: string, existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

export function mintIds(prefix: string, count: number, existing: string[]): string[] {
  const taken = new Set(existing);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = nextId(prefix, taken);
    taken.add(id);
    out.push(id);
  }
  return out;
}
