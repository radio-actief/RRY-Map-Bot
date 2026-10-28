/**
 * The region replies of MeshCore's CLI, rebuilt from its source (src/helpers/RegionMap.cpp and
 * CommonCLI.cpp handleRegionCmd), for tests: every reply goes through a 160-byte buffer.
 * - `region`: the tree, depth-first in table order, cut at 159 bytes mid-line, with no marker;
 * - `region list allowed|denied`: names in table order, a name that does not fit is skipped
 *   (later, shorter names still go in), no marker;
 * - `region get <name>`: " name (parent) F", the parent left out at the top level, F when allowed.
 */
export type FwRegion = { name: string; parent?: string; flood: boolean };

const BUF = 160;

export function regionReplies(table: FwRegion[], { home, wildcardFlood = true }: { home?: string; wildcardFlood?: boolean } = {}) {
  const children = (parent: string | undefined) => table.filter((r) => r.parent === parent);
  let tree = "";
  const print = (indent: number, name: string, flood: boolean, isHome: boolean) => {
    tree += `${" ".repeat(indent)}${name}${isHome ? "^" : ""}${flood ? " F" : ""}\n`;
  };
  const walk = (indent: number, r: FwRegion) => {
    print(indent, r.name, r.flood, r.name === home);
    for (const c of children(r.name)) walk(indent + 1, c);
  };
  print(0, "*", wildcardFlood, !home);
  for (const r of children(undefined)) walk(1, r);
  const cut = (s: string) => new TextDecoder().decode(new TextEncoder().encode(s).slice(0, BUF - 1));

  const list = (allowed: boolean) => {
    let out = wildcardFlood === allowed ? "*," : "";
    for (const r of table) {
      if (r.flood !== allowed) continue;
      if (out.length + r.name.length + 2 < BUF) out += `${r.name},`;
    }
    out = out.replace(/,$/, "");
    return out || "-none-";
  };

  const replies: Record<string, string> = {
    region: cut(tree),
    "region list allowed": list(true),
    "region list denied": list(false),
    "region home": ` home is ${home ?? "*"}`,
    "region default": " default scope is <null>",
  };
  for (const r of table) {
    replies[`region get ${r.name}`] = r.parent ? ` ${r.name} (${r.parent}) ${r.flood ? "F" : ""}` : ` ${r.name} ${r.flood ? "F" : ""}`;
  }
  return { replies, fullTree: tree };
}
