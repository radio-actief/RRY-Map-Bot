// Settings hand-off with NodeBook on the same site, both ways, with a stand-in NodeBook page:
// NodeBook opens /configurator?handoff=1 and sends settings (the configurator asks before using
// them), and the configurator's "Save to NodeBook" opens NodeBook and sends its plan.
import { stub } from "./fixtures/configurator.mjs";

const KEY = "ab".repeat(32);
const TOOLS = [{ key: "nodebook", label: "NodeBook", url: "/nodebook/" }];
const MSG = {
  kind: "bemesh.settings",
  v: 1,
  source: "nodebook",
  public_key: KEY,
  at: "2026-11-10T12:00:00Z",
  settings: { name: "BE-GEN-Handoff", tx: "20", "made.up": "1" },
  regions: ["region put eu", "region put be eu", "region put be-vov be", "region allowf *", "region home be-vov", "region default be", "region save"],
};

/** The stand-in NodeBook: sends MSG from /nodebook/send, receives at /nodebook/#/handoff. */
const NODEBOOK = `<!doctype html><meta charset="utf-8"><title>NodeBook stand-in</title><script>
const MSG = ${JSON.stringify(MSG)};
window.sendToConfigurator = () => {
  const w = window.open("/configurator?handoff=1");
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.source !== w) return;
    if (e.data.kind === "bemesh.ready") w.postMessage(MSG, location.origin);
    if (e.data.kind === "bemesh.received") window.confirmed = true;
  });
};
if (location.hash === "#/handoff" && window.opener) {
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.source !== window.opener) return;
    window.got = e.data;
    window.opener.postMessage({ kind: "bemesh.received", v: 1 }, location.origin);
  });
  window.opener.postMessage({ kind: "bemesh.ready", v: 1 }, location.origin);
}
</script>`;

export default async function (ctx) {
  const context = await ctx.browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const errors = [];
  context.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (m) => m.type() === "error" && !/ERR_NETWORK_CHANGED/.test(m.text()) && errors.push(m.text()));
  });
  await context.route("**/api/v1/site-tools", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(TOOLS) }));
  await context.route("**/nodebook/**", (r) =>
    r.fulfill({ contentType: "text/html", headers: { "Cross-Origin-Opener-Policy": "same-origin" }, body: NODEBOOK }),
  );

  // NodeBook → configurator
  const nb = await context.newPage();
  await stub(nb);
  await nb.goto(ctx.base + "/nodebook/send");
  const [conf] = await Promise.all([context.waitForEvent("page"), nb.evaluate(() => window.sendToConfigurator())]);
  await stub(conf);
  const dialog = conf.locator("dialog[open]");
  await dialog.waitFor({ timeout: 15000 }).catch(() => {});
  const text = (await dialog.textContent().catch(() => "")) || "";
  ctx.check("configurator handoff: settings from NodeBook open a dialog that names them", /Settings from NodeBook/.test(text) && /BE-GEN-Handoff/.test(text), text.slice(0, 200));
  ctx.check("configurator handoff: an unknown setting is listed as skipped", /set made\.up 1/.test(text), text.slice(0, 300));
  ctx.check("configurator handoff: NodeBook got its confirmation", await nb.evaluate(() => window.confirmed === true));
  await dialog.locator('button:has-text("Use these")').click();
  await conf.waitForTimeout(500);
  const notice = (await conf.locator(".notice").textContent().catch(() => "")) || "";
  ctx.check("configurator handoff: Use these makes them the plan", /now your plan/.test(notice), notice);

  // configurator → NodeBook
  await conf.locator('.topbar button:has-text("🛠")').click();
  await conf.waitForSelector(".drawer");
  const [nbIn] = await Promise.all([context.waitForEvent("page"), conf.locator('.drawer button:has-text("Save to NodeBook")').click()]);
  await nbIn.waitForFunction(() => !!window.got, null, { timeout: 15000 }).catch(() => {});
  const got = await nbIn.evaluate(() => window.got ?? null);
  ctx.check(
    "configurator handoff: Save to NodeBook sends the plan, its key and its regions, without passwords",
    got?.kind === "bemesh.settings" && got.settings?.name === "BE-GEN-Handoff" && got.public_key === KEY && got.regions?.includes("region save") && !("password" in (got.settings ?? {})),
    JSON.stringify(got).slice(0, 300),
  );
  await conf.waitForTimeout(500);
  const note = (await conf.locator(".drawer").textContent().catch(() => "")) || "";
  ctx.check("configurator handoff: the drawer says it was sent", /Sent to NodeBook/.test(note), note.slice(-200));
  ctx.check("configurator handoff: no page errors", !errors.length, errors.join("; "));
  await context.close();
}
