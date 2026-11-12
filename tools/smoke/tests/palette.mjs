// The command palette and the keyboard shortcuts: Ctrl+K opens the palette, which finds a player, a member of staff and
// a club and opens each in its own list; Ctrl+1 to 6 show the tabs, Ctrl+F goes to the list's search, Ctrl+E starts
// and ends the editing of the open profile, Ctrl+R reads the game again without loading the page again; under a dialog
// the shortcuts wait. Writes nothing.
import { SHOWN, VIS, sleep } from "../lib/app.mjs";
import { topClubs } from "../lib/witness.mjs";

export const name = "palette";
export const writes = false;

const PALETTE = `document.querySelector(".palette")`;
const INPUT = `document.querySelector(".palette input")`;
const OPTIONS = `[...document.querySelectorAll(".palette-option")]`;
const ACTIVE_TAB = `document.querySelector("nav.tabs .tab.active")?.firstChild?.textContent`;
const PROFILE = `${VIS}(".profile:not(.popup)")`;
const LIST_SEARCH = `${VIS}(".toolbar .search input")`;

/** In the page: the option of the palette's section headed `heading` whose name is `name`. */
const optionIn = (heading, name) => `[...document.querySelectorAll(".palette-section")]
  .find((section) => section.querySelector(".palette-heading")?.textContent === ${JSON.stringify(heading)})
  ?.querySelectorAll(".palette-option").values()
  .find((option) => option.querySelector(".palette-name")?.firstChild?.textContent === ${JSON.stringify(name)})`;

export async function run({ app, report }) {
  const open = async () => {
    await app.chord("k");
    await app.waitFor(`!!${PALETTE}`, "the palette");
  };
  const closed = () => app.waitFor(`!${PALETTE}`, "the palette to close");
  const profileOf = async (who) => {
    await app.waitFor(`${PROFILE} && ${PROFILE}.getAttribute("aria-busy") === "false"`, `the profile of ${who}`, 30000);
    return app.js(`${PROFILE}.querySelector("h2")?.textContent ?? ""`);
  };

  // Opening it, what it lists with nothing typed, and Escape.
  await app.openTab("Players");
  await app.click(LIST_SEARCH, "the players' search");
  await open();
  report.check("Ctrl+K opens the palette, with the caret in its box", await app.js(`document.activeElement === ${INPUT}`));
  const commands = await app.js(`${OPTIONS}.map((option) => option.querySelector(".palette-name").textContent)`);
  report.check("with nothing typed it lists the commands",
    ["Go to Players", "Go to Changes", "Search this list", "Reload data"].every((command) => commands.includes(command)),
    commands.join(", "));
  const keys = await app.js(`${OPTIONS}[0].querySelector(".keys")?.textContent ?? ""`);
  report.check("a command shows its shortcut", keys === "Ctrl1", keys);
  const activeLine = `document.querySelector(".palette-option.active .palette-name")?.textContent ?? ""`;
  await app.press("ArrowDown");
  const down = await app.js(activeLine);
  await app.press("ArrowUp");
  await app.press("ArrowUp");
  const wrapped = await app.js(activeLine);
  report.check("the arrows move through the lines, and from the first to the last",
    down === commands[1] && wrapped === commands.at(-1), `${down}, ${wrapped}`);
  await app.shot("palette-commands");
  await app.press("Escape");
  await closed();
  report.check("Escape closes it, and the caret is back in the list's search",
    await app.js(`document.activeElement === ${LIST_SEARCH}`));
  await open();
  await app.chord("k");
  await closed();
  report.check("Ctrl+K closes it too", true);

  // A player, from the Clubs tab: the palette opens him in the players' list.
  const player = (await app.must("search_players", { query: "", limit: 1 })).rows[0];
  await app.openTab("Clubs");
  await open();
  await app.setInput(INPUT, player.name);
  await app.waitFor(`!!${optionIn("Players", player.name)}`, `${player.name} among the players found`, 30000);
  const first = await app.js(`${OPTIONS}[0].querySelector(".palette-name").textContent`);
  await app.shot("palette-found");
  report.check("the best match is the first line", first === player.name, first);
  await app.press("Enter");
  await closed();
  const playerHeading = await profileOf(player.name);
  report.check("Enter opens the player's profile in the Players tab",
    (await app.js(ACTIVE_TAB)) === "Players" && playerHeading.includes(player.name), `${await app.js(ACTIVE_TAB)}: ${playerHeading}`);

  // A member of staff and a club, by a click.
  const member = (await app.must("search_staff", { query: "", limit: 1 })).rows[0];
  await open();
  await app.setInput(INPUT, member.name);
  await app.waitFor(`!!${optionIn("Staff", member.name)}`, `${member.name} among the staff found`, 30000);
  await app.click(optionIn("Staff", member.name), `the line of ${member.name}`);
  await closed();
  const staffHeading = await profileOf(member.name);
  report.check("a click opens the member of staff's profile in the Staff tab",
    (await app.js(ACTIVE_TAB)) === "Staff" && staffHeading.includes(member.name), `${await app.js(ACTIVE_TAB)}: ${staffHeading}`);

  const [club] = await topClubs(app, 1);
  await open();
  await app.setInput(INPUT, club.name);
  await app.waitFor(`!!${optionIn("Clubs", club.name)}`, `${club.name} among the clubs found`, 30000);
  await app.click(optionIn("Clubs", club.name), `the line of ${club.name}`);
  await closed();
  const clubHeading = await profileOf(club.name);
  report.check("and the club's profile in the Clubs tab",
    (await app.js(ACTIVE_TAB)) === "Clubs" && clubHeading.includes(club.name), `${await app.js(ACTIVE_TAB)}: ${clubHeading}`);

  // The shortcuts of the lists, and of the list's search.
  // The tabs take the digits in their order: My club is the first.
  await app.chord("2");
  await sleep(300);
  const tabOne = await app.js(ACTIVE_TAB);
  await app.chord("3");
  await sleep(300);
  const tabTwo = await app.js(ACTIVE_TAB);
  report.check("Ctrl+2 and Ctrl+3 show the players and the staff", tabOne === "Players" && tabTwo === "Staff", `${tabOne}, ${tabTwo}`);
  await app.chord("2");
  await sleep(300);
  await app.js(`${PROFILE}.querySelector("button")?.focus()`);
  await app.chord("f");
  report.check("Ctrl+F puts the caret in the list's search", await app.js(`document.activeElement === ${LIST_SEARCH}`));

  // Edit, by its shortcut: started and ended with nothing changed.
  if (await app.js(`!!${PROFILE}.querySelector(".edit-toggle:not([disabled])")`)) {
    await app.chord("e");
    await app.waitFor(`${PROFILE}.classList.contains("editing")`, "the profile's inputs", 30000);
    report.check("Ctrl+E starts editing the open profile", true);
    await app.chord("e");
    await app.waitFor(`!${PROFILE}.classList.contains("editing")`, "the editing to end");
    report.check("and ends it", true);
  } else {
    report.skip("Ctrl+E", "the profile has no Edit button: the game cannot be written to");
  }

  // Under a dialog the shortcuts wait.
  const massEdit = `[...document.querySelectorAll(".toolbar button")].filter(${SHOWN}).at(-1)`;
  await app.click(massEdit, "Mass edit");
  await app.waitFor(`!!document.querySelector(".modal")`, "the mass edit dialog");
  await app.chord("k");
  await app.chord("3");
  await sleep(300);
  report.check("under a dialog the palette stays shut and the tabs stay put",
    !(await app.js(`!!${PALETTE}`)) && (await app.js(ACTIVE_TAB)) === "Players");
  await app.press("Escape");
  await app.waitFor(`!document.querySelector(".modal")`, "the dialog to close");

  // Ctrl+R reads the game again; the page itself is not loaded again, as the web view would do with the key.
  await app.js(`(window.__smokeLoaded = true)`);
  await app.chord("r");
  await sleep(500);
  await app.waitFor(`!document.querySelector(".masthead .busy")`, "the data to be read again", 180000);
  report.check("Ctrl+R reads the data again without loading the page again",
    (await app.js(`window.__smokeLoaded === true`)) && (await app.js(`!!document.querySelector(".views")`)));

  const log = await app.must("change_log");
  report.check("nothing was written", log.length === 0, `${log.length} changes`);
}
