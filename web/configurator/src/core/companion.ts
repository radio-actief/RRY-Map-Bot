/**
 * Companion channels: which public hashtag channels a phone in Belgium should add, with which
 * region, and the meshcore:// link (and QR code) that adds one in the MeshCore app.
 *
 * The list lives in data/companion-channels.json. A hashtag channel's secret is the first 16 bytes
 * of sha256("#name") (MeshCore docs/companion_protocol.md, "Hashtag Channels"); the link format is
 * MeshCore docs/qr_codes.md, "Add Channel", with region_scope from MeshCore app 1.47.
 */
import { sha256Hex } from "./sha256";
import type { Place } from "./search";

export type ChannelGroup = "national" | "flanders" | "local" | "tools";

/** `scope` is a region code, or OWN_PROVINCE for a channel that takes the visitor's own province. */
export type Channel = {
  name: string;
  purpose: string;
  scope: string;
  province?: string;
  city?: string;
  group: ChannelGroup;
  recommended?: boolean;
  link?: string;
  source: string[];
};

export type ChannelData = {
  checked: string;
  sources: Record<string, { title: string; url?: string }>;
  channels: Channel[];
};

/** What the visitor picked: all of Belgium, a province or a place. */
export type CompanionPick = { type: "country" } | { type: "province"; code: string } | { type: "city"; place: Place };

/** A channel as the page shows it: the region it carries for this pick (null: none yet), and whether it is the picked place's own. */
export type ShownChannel = { channel: Channel; scope: string | null; own: boolean };

export const OWN_PROVINCE = "own-province";
const GROUPS: ChannelGroup[] = ["national", "flanders", "local", "tools"];

/** Channels that stay off the page (decided 2026-10-28): busy, test, mapping or Thursday-only channels. */
export const EXCLUDED_CHANNELS = ["#nerdland", "#ON0WV", "#test", "#mc-radar", "#wardriving", "#coredrive", "#burgernet", "#emergency"];

/** The 16-byte secret of a public hashtag channel, as 32 hex characters. */
export function channelSecret(name: string): string {
  return sha256Hex(name).slice(0, 32);
}

/** The link that adds the channel in the MeshCore app; without a region, region_scope is left out. */
export function channelLink(name: string, scope: string | null): string {
  const base = `meshcore://channel/add?name=${encodeURIComponent(name)}&secret=${channelSecret(name)}`;
  return scope ? `${base}&region_scope=${encodeURIComponent(scope)}` : base;
}

/** The province of a pick; null for all of Belgium. */
export function pickProvince(pick: CompanionPick): string | null {
  if (pick.type === "province") return pick.code;
  if (pick.type === "city") return pick.place.province_code;
  return null;
}

/** The region a channel carries for this pick: its own, or the picked province for OWN_PROVINCE. */
export function scopeFor(channel: Channel, pick: CompanionPick): string | null {
  return channel.scope === OWN_PROVINCE ? pickProvince(pick) : channel.scope;
}

/**
 * The channels for a pick, per group: the national ones and those active mostly in Flanders
 * always (the wiki's grouping, for reference only: they keep region be); the local ones of the picked
 * province (a picked place's own channel first); the tools, with the picked province as region.
 */
export function channelsFor(channels: Channel[], pick: CompanionPick): Record<ChannelGroup, ShownChannel[]> {
  const province = pickProvince(pick);
  const city = pick.type === "city" ? pick.place.city_code : null;
  const show = (c: Channel): ShownChannel => ({ channel: c, scope: scopeFor(c, pick), own: !!city && c.city === city });
  const local = channels.filter((c) => c.group === "local" && province && c.province === province).map(show);
  return {
    national: channels.filter((c) => c.group === "national").map(show),
    flanders: channels.filter((c) => c.group === "flanders").map(show),
    local: [...local.filter((c) => c.own), ...local.filter((c) => !c.own)],
    tools: channels.filter((c) => c.group === "tools").map(show),
  };
}

const HASHTAG = /^#[a-z0-9][a-z0-9-]*$/;

/**
 * What is wrong with the channel list, one line per problem: names must be unique lowercase
 * hashtags (no private channels, no secrets) and not excluded; regions must be known codes; a local
 * channel's region is its province, and its city lies in that province; sources must be listed.
 */
export function channelErrors(data: ChannelData, regionCodes: string[], places: Place[]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  for (const c of data.channels) seen.set(c.name.toLowerCase(), (seen.get(c.name.toLowerCase()) ?? 0) + 1);
  const excluded = new Set(EXCLUDED_CHANNELS.map((n) => n.toLowerCase()));
  const codes = new Set(regionCodes);
  for (const c of data.channels) {
    const at = `${c.name}:`;
    if ((seen.get(c.name.toLowerCase()) ?? 0) > 1) errors.push(`${at} duplicate name`);
    if (!HASHTAG.test(c.name)) errors.push(`${at} not a public lowercase hashtag channel`);
    if ("secret" in c) errors.push(`${at} has a secret: private channels are never listed`);
    if (excluded.has(c.name.toLowerCase())) errors.push(`${at} is kept off the page`);
    if (!c.purpose?.trim()) errors.push(`${at} no purpose`);
    if (!GROUPS.includes(c.group)) errors.push(`${at} unknown group ${c.group}`);
    if (c.scope === OWN_PROVINCE ? c.group !== "tools" : !codes.has(c.scope)) errors.push(`${at} unknown region ${c.scope}`);
    if (c.group === "local") {
      if (!c.province || c.province !== c.scope) errors.push(`${at} a local channel's region must be its province`);
      if (c.city && !places.some((p) => p.city_code === c.city && p.province_code === c.province)) {
        errors.push(`${at} city ${c.city} is not in ${c.province}`);
      }
    } else if (c.province || c.city) errors.push(`${at} only local channels have a province or city`);
    if (!c.source?.length) errors.push(`${at} no source`);
    for (const s of c.source ?? []) if (!data.sources[s]) errors.push(`${at} unknown source ${s}`);
  }
  return errors;
}
