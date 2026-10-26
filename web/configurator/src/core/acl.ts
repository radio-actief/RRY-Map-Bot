/** Repeater access list: parsing `get acl` output and building the `setperm` lines that change it. */

export type AclRole = 1 | 2 | 3;
/** `perms` is the raw byte as read, kept only when it has bits above the role. */
export type AclEntry = { key: string; role: AclRole; perms?: number };

/** The firmware holds at most this many entries. */
export const ACL_MAX = 32;

const LINE = /^([0-9a-f]{2}) ([0-9a-f]{64})$/i;

/** Entries from `get acl` output, or null when there is no `ACL:` line. */
export function parseAcl(output: string): AclEntry[] | null {
  const lines = output.split("\n").map((l) => l.trim());
  if (!lines.includes("ACL:")) return null;
  const out: AclEntry[] = [];
  for (const line of lines) {
    const m = LINE.exec(line);
    if (!m) continue;
    const perms = parseInt(m[1], 16);
    const role = perms & 3;
    if (role === 0) continue;
    const entry: AclEntry = { key: m[2].toLowerCase(), role: role as AclRole };
    if (perms > 3) entry.perms = perms;
    out.push(entry);
  }
  return out;
}

/** A pasted public key as 64 lowercase hex characters, or null. */
export function normaliseKey(text: string): string | null {
  const key = text.replace(/[\s-]/g, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(key) ? key : null;
}

/** `setperm` lines turning `from` into `to`: removals first, then additions and role changes. */
export function aclLines(from: AclEntry[], to: AclEntry[]): string[] {
  const before = new Map(from.map((e) => [e.key, e.role]));
  const after = new Set(to.map((e) => e.key));
  const lines = from.filter((e) => !after.has(e.key)).map((e) => `setperm ${e.key} 0`);
  for (const e of to) if (before.get(e.key) !== e.role) lines.push(`setperm ${e.key} ${e.role}`);
  return lines;
}

/** How many entries differ: role changes, additions and removals. */
export function aclChanges(from: AclEntry[] | undefined, to: AclEntry[] | undefined): number {
  return aclLines(from ?? [], to ?? []).length;
}
