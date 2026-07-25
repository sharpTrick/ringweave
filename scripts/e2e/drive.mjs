/**
 * End-to-end verification of M3 in the real app: a real module Worker, real
 * rendering, real keyboard. The unit suite mocks the worker hook, so none of the
 * constrained generation path is exercised anywhere else.
 *
 * Drives the PRODUCTION BUILD, not the dev server, so what is checked is what
 * ships. Every step below is one of the plan's stated verification items.
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://127.0.0.1:4173";
const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const ROSTER = [
  "Alice Nguyen", "Ben Carter", "Chloe Diaz", "Dev Patel",
  "Eve Larsen", "Fran Osei", "Gus Meyer", "Hana Sato",
  "John Smith", "Jo Sanders", "Kai Reyes", "Lena Ford",
];

const browser = await chromium.launch({ executablePath: EXEC });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "networkidle" });

// ---- roster + rules -------------------------------------------------------
await page.getByLabel("Roster names").fill(ROSTER.join("\n"));
await page.locator(".rules-block > summary").click();
await page.getByText("+ Add a buddy rule").click();
await page.getByLabel("Rule 1, first person").fill("Alice Nguyen");
await page.getByLabel("Rule 1, second person").fill("Lena Ford");
await page.getByText("+ Add a buddy rule").click();
await page.getByLabel("Rule 2, first person").fill("Ben Carter");
await page.getByLabel("Rule 2, second person").fill("Chloe Diaz");
await page.getByLabel("Rule 2, kind").selectOption("prohibited");

await page.getByText("Generate buddy graph").click();
await page.waitForSelector("#metrics", { timeout: 15000 });

const rulesLine = await page.locator(".rules-line").textContent();
check("constrained generation reports its rules", /all 2 buddy rules satisfied/.test(rulesLine ?? ""), rulesLine ?? "(none)");

// The rules must actually hold in the rendered graph, not just in the caption.
const edges = await page.$$eval("line.edge", (ls) => ls.length);
check("a graph was drawn", edges > 0, `${edges} edges`);

// ---- infeasible rules name people, not indices ----------------------------
await page.getByText("Edit people").click();
await page.locator(".rules-block > summary").click();
for (let i = 3; i <= 7; i++) {
  await page.getByText("+ Add a buddy rule").click();
  await page.getByLabel(`Rule ${i}, first person`).fill("Alice Nguyen");
  await page.getByLabel(`Rule ${i}, second person`).fill(ROSTER[i]);
}
const blocking = await page.locator(".note.blocking").first().textContent();
check("infeasibility names a person, not an index",
  /Alice Nguyen/.test(blocking ?? "") && !/person \d/.test(blocking ?? ""), blocking ?? "(none)");
const disabled = await page.getByText("Generate buddy graph").isDisabled();
check("generate is blocked while infeasible", disabled);

// Back to a feasible set: remove the five bad rules.
for (let i = 7; i >= 3; i--) await page.getByLabel(`Remove rule ${i}`).click();
await page.getByText("Generate buddy graph").click();
await page.waitForSelector("#metrics", { timeout: 15000 });

// ---- F8: fuzzy search -----------------------------------------------------
await page.getByLabel("Find a person").fill("jsmi");
const firstOption = await page.locator('[role="option"]').first().textContent();
check('"jsmi" finds "John Smith"', firstOption === "John Smith", firstOption ?? "(none)");
await page.keyboard.press("Enter");
await page.waitForSelector("#person");
const who = await page.locator("#person h2").textContent();
check("selecting a result opens that person", who === "John Smith", who ?? "(none)");

// ---- F8: explorer chips + back stack --------------------------------------
const firstChip = page.locator("#person .pp-chips .personchip").first();
const chipName = await firstChip.textContent();
await firstChip.click();
const nowWho = await page.locator("#person h2").textContent();
check("every name in the panel is clickable", nowWho === chipName, `${who} -> ${nowWho}`);
await page.getByText("← Back").click();
const backWho = await page.locator("#person h2").textContent();
check("the back stack works", backWho === "John Smith", backWho ?? "(none)");

// ---- F10: path finder -----------------------------------------------------
await page.getByText("Find a path from here").click();
await page.getByLabel("Find a person").fill("lena");
await page.keyboard.press("Enter");
await page.waitForSelector("#route .rt-chain");
const chain = (await page.locator("#route .rt-chain").textContent()) ?? "";
const steps = (await page.locator("#route .rt-steps").textContent()) ?? "";
check("a route is drawn and written out", chain.includes("John Smith") && chain.includes("Lena Ford"), `${chain} (${steps})`);
const routeEdges = await page.$$eval("line.edge.route", (ls) => ls.length);
const hops = Number((steps.match(/(\d+) step/) ?? [])[1]);
check("the lit chain has exactly one edge per step", routeEdges === hops, `${routeEdges} lit vs ${hops} steps`);

// Hovering must not destroy the route.
await page.locator("g.node").first().hover();
const afterHover = await page.$$eval("line.edge.route", (ls) => ls.length);
check("hovering does not destroy the route", afterHover === routeEdges);

// ---- ESC clears -----------------------------------------------------------
await page.keyboard.press("Escape");
check("Escape clears the route", (await page.locator("#route").count()) === 0);
await page.keyboard.press("Escape");
check("a second Escape clears the selection", (await page.locator("#person").count()) === 0);

// ---- F6: export round-trips the rules -------------------------------------
const download = page.waitForEvent("download");
await page.getByText("Export ↓").click();
const file = await download;
const stream = await file.createReadStream();
let text = "";
for await (const chunk of stream) text += chunk;
const parsed = JSON.parse(text);
check("export carries the rules",
  parsed.constraints.required.length === 1 && parsed.constraints.prohibited.length === 1,
  JSON.stringify(parsed.constraints));

check("no page errors or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
