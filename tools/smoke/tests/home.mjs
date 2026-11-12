// My club: the page about the club the user manages. Its head names that club, its cards count what the squad command
// says of the first team, a name in a card opens the player over the page, Club profile opens the club in the Clubs
// tab, and Ctrl+1 comes back. In a save where the user has no club, the page offers to follow one. Writes nothing.
import { VIS } from "../lib/app.mjs";
import { humanClubs } from "../lib/witness.mjs";

export const name = "home";
export const writes = false;

const ACTIVE_TAB = `document.querySelector("nav.tabs .tab.active")?.firstChild?.textContent`;
const POPUP = `document.querySelector(".modal-backdrop .profile.popup")`;
const PROFILE = `${VIS}(".profile:not(.popup)")`;

export async function run({ app, report }) {
  const own = await humanClubs(app);
  await app.openTab("My club");
  if (own.length === 0) {
    await app.waitFor(`!!document.querySelector(".home-pick input")`, "the search for a club to follow");
    report.check("with no club of the user's, the page offers to follow one", true);
    return;
  }

  await app.waitFor(
    `!!document.querySelector(".home-head .home-facts") && document.querySelectorAll(".home .squad-grid tbody tr").length > 0`,
    "the page",
    30000,
  );
  const club = (await app.must("search_clubs", { query: String(own[0]), limit: 5 })).rows.find((row) => row.uid === own[0]);
  const heading = await app.js(`document.querySelector(".home-head h2")?.firstChild?.textContent ?? ""`);
  report.check("the page is about the club the user manages", heading === club?.name, `${heading} (expected ${club?.name})`);
  const facts = await app.js(`[...document.querySelectorAll(".home-facts dt")].map((label) => label.textContent)`);
  report.check("its head has the club's reputation", facts.includes("Reputation"), facts.join(", "));

  // The cards against the squad command: the first team is the one shown.
  const [first] = await app.must("club_squads", { uid: own[0] });
  const counts = await app.js(`Object.fromEntries([...document.querySelectorAll(".home-card")].map((card) =>
    [card.querySelector("h3").textContent, Number(card.querySelector(".home-card-count").textContent)]))`);
  const injured = first.players.filter((player) => player.injuries > 0).length;
  const banned = first.players.filter((player) => player.bans > 0).length;
  const lowMorale = first.players.filter((player) => player.morale < 10).length;
  report.check("the cards count the first team's injured, banned and those with low morale",
    counts.Injured === injured && counts.Banned === banned && counts["Low morale"] === lowMorale,
    `${JSON.stringify(counts)} (expected ${injured}, ${banned}, ${lowMorale})`);
  const rows = await app.js(`document.querySelectorAll(".home .squad-grid tbody tr").length`);
  report.check("the squad under them lists the first team", rows === first.players.length, `${rows} of ${first.players.length}`);
  await app.shot("home");

  // A name in a card opens the player over the page.
  const link = `document.querySelector(".home-card .name-link")`;
  if (await app.js(`!!${link}`)) {
    const who = await app.js(`${link}.textContent`);
    await app.click(link, `the name ${who}`);
    await app.waitFor(`${POPUP} && ${POPUP}.getAttribute("aria-busy") === "false"`, "the player's profile", 30000);
    const opened = await app.js(`${POPUP}.querySelector("h2")?.textContent ?? ""`);
    report.check("a name in a card opens the player over the page", opened.includes(who), `${opened} (expected ${who})`);
    await app.press("Escape");
    await app.waitFor(`!${POPUP}`, "the dialog to close");
    report.check("Escape closes him, and the page stays", await app.js(`!!document.querySelector(".home-head")`));
  } else {
    report.skip("a name in a card", "no card names anyone in this save");
  }

  // The club's profile, and back.
  await app.click(`document.querySelector(".home-buttons button:not([disabled])")`, "Club profile");
  await app.waitFor(`${ACTIVE_TAB} === "Clubs"`, "the Clubs tab");
  await app.waitFor(`${PROFILE} && ${PROFILE}.getAttribute("aria-busy") === "false"`, "the club's profile", 30000);
  const profile = await app.js(`${PROFILE}.querySelector("h2")?.textContent ?? ""`);
  report.check("Club profile opens the club in the Clubs tab", profile.includes(heading), profile);
  await app.chord("1");
  await app.waitFor(`!!document.querySelector(".home-head")`, "My club");
  report.check("Ctrl+1 shows My club again", (await app.js(ACTIVE_TAB)) === "My club");

  const log = await app.must("change_log");
  report.check("nothing was written", log.length === 0, `${log.length} changes`);
}
