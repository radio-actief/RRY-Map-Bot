// The map copes with a node that has no name: every marker still draws, search still works,
// and a search highlight on a name with "&" or "<" keeps the name intact.
const key = (i) => (i + 1).toString(16).padStart(2, "0").repeat(32);
const base = (i) => ({
  public_key: key(i),
  // Far apart, so the map doesn't cluster them.
  adv_lat: [51.2, 50.5, 50.0][i],
  adv_lon: [3.0, 4.5, 5.8][i],
  city: "Gent",
  type: 1,
  source: "app",
  inserted_date: new Date().toISOString(),
  updated_date: new Date().toISOString(),
  last_advert: new Date().toISOString(),
  params: { bw: 62.5, cr: 8, freq: 869.618, sf: 8 },
});
const nodes = [
  { ...base(0), adv_name: null },
  { ...base(1), adv_name: "Tom & Jerry <3" },
  { ...base(2), adv_name: "Plain one", type: 2 },
];

export default async function (ctx) {
  const page = await ctx.open("/", {
    setup: (p) => p.route("**/api/v1/belgian-nodes", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(nodes) })),
  });
  await page.waitForTimeout(1500);
  const markers = await page.locator(".leaflet-marker-icon").count();
  ctx.check("map nameless: every node draws, also one without a name", markers === 3, String(markers));

  const box = page.locator(".search-row .input");
  await box.fill(key(0).slice(0, 10));
  await page.waitForTimeout(400);
  const hits = await page.locator(".search-results li").count();
  ctx.check("map nameless: a search by key finds the nameless node", hits >= 1, String(hits));

  await box.fill("jerry");
  await page.waitForTimeout(400);
  const shown = await page.locator(".search-results li").first().innerText().catch(() => "");
  const bold = await page.locator(".search-results li b").first().innerText().catch(() => "");
  ctx.check("map nameless: the highlight keeps a name with & and < intact", shown.includes("Tom & Jerry <3") && bold.toLowerCase() === "jerry", JSON.stringify({ shown, bold }));
  ctx.check("map nameless: no page errors", !page.errors.length, page.errors.join("; "));
  await page.close();
}
