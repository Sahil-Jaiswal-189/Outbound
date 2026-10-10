import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const assets = join(root, "docs/assets");
const results = join(root, "test-results");
const directories = await readdir(results);
await mkdir(assets, { recursive: true });

async function artifact(prefix, project, file) {
  const directory = directories.find(name => name.startsWith(prefix) && name.endsWith(`-${project}`));
  assert.ok(directory, `Run npm run test:browser first: missing ${prefix}/${project}`);
  return join(results, directory, file);
}

const pictures = {
  "home.png": ["app-destination-quests", "desktop", "home-deck.png"],
  "quests.png": ["app-destination-quests", "desktop", "destination-quest.png"],
  "lab.png": ["app-destination-quests", "desktop", "scoring-lab.png"],
  "sources.png": ["app-destination-quests", "desktop", "source-evidence.png"],
  "catalog.png": ["app-all-120-activities", "desktop", "activity-library-full.png"],
  "profile.png": ["app-fresh-UI", "desktop", "profile.png"],
  "field-mobile.png": ["app-demo-lab", "mobile", "field-timer.png"],
  "reflection-mobile.png": ["app-demo-lab", "mobile", "reflection.png"],
  "choose-mobile.png": ["app-all-120-activities", "mobile", "activity-library-full.png"]
};
for (const [target, source] of Object.entries(pictures)) await copyFile(await artifact(...source), join(assets, target));
const dataUrl = async path => `data:image/png;base64,${(await readFile(path)).toString("base64")}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1180 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(assets, "architecture.svg")).href);
  const offCanvas = await page.locator("svg text").evaluateAll(elements => elements.filter(text => {
    const box = text.getBBox();
    return box.x < 0 || box.y < 0 || box.x + box.width > 1680 || box.y + box.height > 1180;
  }).map(text => text.textContent));
  assert.deepEqual(offCanvas, [], "Diagram labels must fit inside the figure");
  await page.screenshot({ path: join(assets, "architecture.png") });

  await page.goto("about:blank");
  const screens = await Promise.all(["choose-mobile.png", "field-mobile.png", "reflection-mobile.png"].map(file => dataUrl(join(assets, file))));
  await page.setViewportSize({ width: 1440, height: 1160 });
  await page.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box}body{margin:0;padding:48px 65px;background:#f8fbfa;font:20px Arial,sans-serif;color:#183b33;letter-spacing:0}
    h1{font-size:38px;margin:0 0 14px}p{margin:0 0 32px;color:#526762}main{display:grid;grid-template-columns:repeat(3,390px);gap:70px}
    h2{font-size:24px;margin:0 0 14px}img{display:block;width:390px;height:844px;border:1px solid #d4e2da;border-radius:8px}
    footer{font-size:18px;margin-top:30px;color:#526762}
  </style></head><body><h1>The screen is the starting point, not the destination.</h1>
    <p>Outbound | A short choice, a real-world action, a small reflection</p><main>
    ${screens.map((src, i) => `<section><h2>${["1. Choose something small", "2. Go do it", "3. Tell us how it felt"][i]}</h2><img src="${src}" alt="${["Activity catalog", "Field timer", "Reflection form"][i]}"></section>`).join("")}
    </main><footer>Actual application UI | Automated demo fixtures | No claim of a real outdoor field test</footer></body></html>`);
  await page.locator("img").evaluateAll(images => Promise.all(images.map(image => image.decode())));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(assets, "outdoor-loop.png") });
  console.log(`Publication assets rebuilt in ${assets}; all screenshots use test fixtures.`);
} finally { await browser.close(); }
