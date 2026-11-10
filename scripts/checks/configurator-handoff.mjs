// Settings hand-off with NodeBook in the address fragment, both ways, with a stand-in NodeBook page
// on a path of this site: NodeBook opens /configurator#handoff=<data> (the configurator asks before
// using it), and the configurator's "Save to NodeBook" opens <nodebook>#/handoff?d=<data>.
// separate-addresses.mjs does the same with NodeBook on another address.
import { stub } from "./fixtures/configurator.mjs";

const KEY = "ab".repeat(32);
const TOOLS = [{ key: "nodebook", label: "NodeBook", url: "/nodebook/" }];
export const MSG = {
  kind: "bemesh.settings",
  v: 1,
  source: "nodebook",
  public_key: KEY,
  at: "2026-11-10T12:00:00Z",
  settings: { name: "BE-GEN-Zoë", tx: "20", "made.up": "1" },
  regions: ["region put eu", "region put be eu", "region put be-vov be", "region allowf *", "region home be-vov", "region default be", "region save"],
};

/**
 * The stand-in NodeBook's script: window.sendToConfigurator(url) opens the configurator with MSG in
 * its fragment; at #/handoff?d=<data> it decodes what arrived into window.got.
 */
export const NODEBOOK_SCRIPT = `
const MSG = ${JSON.stringify(MSG)};
const enc = (o) => {
  const b = new TextEncoder().encode(JSON.stringify(o));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
};
const dec = (t) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
window.sendToConfigurator = (url) => window.open(url + "#handoff=" + enc(MSG), "_blank", "noopener");
const m = /^#\\/handoff\\?d=([A-Za-z0-9_-]+)$/.exec(location.hash);
if (m) window.got = dec(m[1]);
`;
const NODEBOOK = `<!doctype html><meta charset="utf-8"><title>NodeBook stand-in</title><script>${NODEBOOK_SCRIPT}</script>`;

/** Runs the hand-off both ways; `nbBase` is NodeBook's address, `confUrl` the configurator's. */
export async function handoffBothWays(ctx, context, { name, nb, confUrl, errors }) {
  // NodeBook → configurator
  const [conf] = await Promise.all([context.waitForEvent("page"), nb.evaluate((u) => window.sendToConfigurator(u), confUrl)]);
  await stub(conf);
  const dialog = conf.locator("dialog[open]");
  await dialog.waitFor({ timeout: 15000 }).catch(() => {});
  const text = (await dialog.textContent().catch(() => "")) || "";
  ctx.check(`${name}: settings from NodeBook open a dialog that names them`, /Settings from NodeBook/.test(text) && /BE-GEN-Zoë/.test(text), text.slice(0, 200));
  ctx.check(`${name}: an unknown setting is listed as skipped`, /set made\.up 1/.test(text), text.slice(0, 300));
  const address = conf.url();
  ctx.check(`${name}: the settings are taken out of the address`, !address.includes("#") && address.endsWith("/configurator"), address);
  await dialog.locator('button:has-text("Use these")').click();
  await conf.waitForTimeout(500);
  const notice = (await conf.locator(".notice").textContent().catch(() => "")) || "";
  ctx.check(`${name}: Use these makes them the plan`, /now your plan/.test(notice), notice);

  // configurator → NodeBook
  await conf.locator('.topbar button:has-text("🛠")').click();
  await conf.waitForSelector(".drawer");
  const [nbIn] = await Promise.all([context.waitForEvent("page"), conf.locator('.drawer button:has-text("Save to NodeBook")').click()]);
  await nbIn.waitForFunction(() => !!window.got, null, { timeout: 15000 }).catch(() => {});
  const got = await nbIn.evaluate(() => window.got ?? null).catch(() => null);
  ctx.check(
    `${name}: Save to NodeBook sends the plan, its key and its regions, without passwords`,
    got?.kind === "bemesh.settings" && got.settings?.name === "BE-GEN-Zoë" && got.public_key === KEY && got.regions?.includes("region save") && !("password" in (got.settings ?? {})),
    JSON.stringify(got).slice(0, 300),
  );
  ctx.check(`${name}: NodeBook opens without a link back to the configurator`, (await nbIn.evaluate(() => window.opener === null).catch(() => false)) === true);
  const note = (await conf.locator(".drawer").textContent().catch(() => "")) || "";
  ctx.check(`${name}: the drawer says it was sent`, /Sent to NodeBook\. Check and save them there\./.test(note), note.slice(-200));
  ctx.check(`${name}: no page errors`, !errors.length, errors.join("; "));
}

export default async function (ctx) {
  const context = await ctx.browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const errors = [];
  context.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => m.type() === "error" && !/ERR_NETWORK_CHANGED/.test(m.text()) && errors.push(m.text()));
  });
  await context.route("**/api/v1/site-tools", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(TOOLS) }));
  await context.route("**/nodebook/**", (r) => r.fulfill({ contentType: "text/html", body: NODEBOOK }));
  const nb = await context.newPage();
  await stub(nb);
  await nb.goto(ctx.base + "/nodebook/send");
  await handoffBothWays(ctx, context, { name: "configurator handoff", nb, confUrl: ctx.base + "/configurator", errors });
  await context.close();
}
