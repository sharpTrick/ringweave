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

/**
 * Wait for a generation to FINISH, not merely for the results panel to exist.
 *
 * `waitForSelector("#metrics")` is not a wait at all after the first generation — the
 * panel is still mounted from the previous one, so it returns instantly while the new run
 * is still going. That race was invisible while the page stayed interactive during
 * generation; now that `#app` is correctly `inert` behind the "Generating…" overlay, the
 * next step lands on a non-interactive control instead. Waiting for the overlay to go is
 * the condition that was always meant.
 */
async function generationSettles(page) {
  await page.waitForSelector("#metrics", { timeout: 15000 });
  await page.waitForSelector(".busy", { state: "detached", timeout: 20000 });
  await page.waitForSelector("#app:not([inert])", { timeout: 20000 });
}

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

// ---- a11y: the setup dialog must be operable on the very first paint ---------
// The regression this exists for: RosterModal was rendered INSIDE the element carrying
// `inert`, and `inert` cascades with no way for a descendant to opt back in. Since the
// modal opens on load, that made the entire first paint unreachable by keyboard and absent
// from the accessibility tree — while rendering perfectly. A jsdom test can assert the
// containment but not the behaviour, because jsdom does not implement inert; only a real
// browser can be asked whether the control can actually be focused and typed into.
{
  const dialogInert = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return "no dialog";
    for (const el of document.querySelectorAll("[inert]")) if (el.contains(dialog)) return "inert ancestor";
    return "ok";
  });
  check("the setup dialog is not inside an inert ancestor", dialogInert === "ok", dialogInert);

  // ASSERTED BEFORE ANYTHING TOUCHES IT. The previous version focused the field first and then
  // checked that the focus had stuck — which proves the field is focusABLE, not that the app ever
  // focuses it, and the app did not. On a cold load `#app` is inert and this dialog is the whole
  // accessible page, so focus sitting on <body> means a screen reader is never told a dialog
  // opened. Only a real browser can settle this one: jsdom will happily report focus wherever it
  // was put.
  const landed = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  check("focus lands in the setup dialog on cold load", landed === "Roster names", landed ?? "(none)");
  const roster = page.getByLabel("Roster names");
  await roster.focus();
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  check("the roster field can actually take focus", focused === "Roster names", focused ?? "(none)");
}

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
await generationSettles(page);

// `.rules-line` is the class the quality panel uses for EVERY disclosure line — the buddy
// count shortfall, the separation shortfall, and the constraint summary — so the locator
// has to name which one. Reading "the first .rules-line" would silently follow whichever
// disclosure happens to render first.
const rulesLine = await page.locator(".rules-line", { hasText: /buddy rule/ }).textContent();
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
await generationSettles(page);

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

// ---- a11y: closing a panel must not strand focus on <body> ------------------
// Removing the focused element moves focus to <body> per spec, so the next Tab restarts at
// the top of the document. Nothing in app/src called .focus() at all.
{
  await page.locator(".brow").first().click();
  await page.waitForSelector("#person");
  await page.getByLabel("Close person details").focus();
  await page.getByLabel("Close person details").click();
  const landed = await page.evaluate(() => {
    const a = document.activeElement;
    return a === document.body || !a ? "body" : (a.getAttribute("aria-label") ?? a.tagName);
  });
  check("closing the person panel keeps focus somewhere usable", landed !== "body", landed);
}

check("no page errors or console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
