// Freezing a player's attributes: the probe changes one as the game would, and the app puts it back within its 2 s
// hold; unfrozen, a changed value stays. The same for a member of staff, and for a player's positions, which are held
// exactly. What the probe changed is written back.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { App, SHOWN, sleep } from "../lib/app.mjs";
import { clubPlayers, topClubs } from "../lib/witness.mjs";

export const name = "freeze";
export const writes = true;

/** Long enough for the app's hold, every 2 s, to have put back what the probe changed. */
const HOLD = 4500;

/** The dialog that a player's name in a club's squad opens. */
const POPUP = `document.querySelector(".modal-backdrop .profile.popup")`;

export async function run({ app, report, probe }) {
  const [, , , club] = await topClubs(app, 4);
  const [player] = await clubPlayers(app, club, 1);
  const field = "attribute.finishing";
  const original = probe.get("player", player.uid, [field])[field];
  const lowered = original > 20 ? original - 10 : original + 10;
  report.note(`witness: ${player.name} (${player.uid}), finishing ${original}`);
  try {
    const frozen = await app.must("freeze_attributes", { uid: player.uid, frozen: true });
    report.check("freezes his attributes", frozen.includes(player.uid));
    const file = join(app.folder, "data", "frozen.json");
    report.check("remembers it in frozen.json", existsSync(file) && readFileSync(file, "utf8").includes(String(player.uid)));
    probe.set("player", player.uid, field, lowered);
    await sleep(4500);
    const held = probe.get("player", player.uid, [field])[field];
    report.check("puts back what the game changed", held === original, `changed to ${lowered}, reads ${held}`);

    const unfrozen = await app.must("freeze_attributes", { uid: player.uid, frozen: false });
    report.check("unfreezes them", !unfrozen.includes(player.uid));
    probe.set("player", player.uid, field, lowered);
    await sleep(4500);
    const free = probe.get("player", player.uid, [field])[field];
    report.check("then leaves a changed value alone", free === lowered, `reads ${free}`);
  } finally {
    await app.invoke("freeze_attributes", { uid: player.uid, frozen: false });
    probe.set("player", player.uid, field, original);
    report.check("finishing written back", probe.get("player", player.uid, [field])[field] === original);
  }

  await positions({ app, report, probe, club, player });

  // The same for a member of staff: the best known coach of the clubs no human manages.
  const human = new Set((await app.must("search_staff", { query: "", limit: 20 })).rows.filter((m) => m.isHuman).map((m) => m.uid));
  const coaches = (await app.must("search_staff", { query: "", limit: 60 })).rows;
  const member = coaches.find((m) => !human.has(m.uid) && m.clubUid != null);
  if (!member) {
    report.skip("freezes a member of staff's attributes", "no member of staff at a club");
    return;
  }
  // The attribute he is best at, which the probe lowers as the game would: one at its lowest cannot get worse (a
  // director of football has 1 for tactics).
  const fields = (await app.must("edit_fields", { entity: "staff" })).filter((f) => f.key.startsWith("attribute."));
  const keys = fields.map((f) => f.key);
  const before = probe.get("staff", member.uid, keys);
  const key = keys.reduce((best, k) => (before[k] > before[best] ? k : best));
  const was = before[key];
  const worse = Math.max(1, was - 10);
  report.note(`witness: ${member.name} (${member.uid}), ${key} ${was}`);
  try {
    const frozen = await app.must("freeze_staff_attributes", { id: member.uid, frozen: true });
    report.check("freezes a member of staff's attributes", frozen.includes(member.uid));
    probe.set("staff", member.uid, key, worse);
    await sleep(4500);
    const held = probe.get("staff", member.uid, [key])[key];
    report.check("puts back what the game changed for him", held === was, `changed to ${worse}, reads ${held}`);
    const unfrozen = await app.must("freeze_staff_attributes", { id: member.uid, frozen: false });
    report.check("unfreezes his attributes", !unfrozen.includes(member.uid));
  } finally {
    await app.invoke("freeze_staff_attributes", { id: member.uid, frozen: false });
    probe.set("staff", member.uid, key, was);
    report.check(`his ${key} written back`, probe.get("staff", member.uid, [key])[key] === was);
  }

  // Max attributes for him, read back by the probe, and its batch undone.
  const maxed = await app.must("max_staff_attributes", { id: member.uid });
  const best = probe.get("staff", member.uid, keys);
  const atBest = fields.every((f) => best[f.key] === (f.scale === "attribute" ? 100 : 20) || best[f.key] === before[f.key]);
  report.check("Max attributes sets his attributes to their best", maxed.failed.length === 0 && atBest, `${maxed.applied} written`);
  const batch = (await app.must("change_log")).find((c) => c.uid === member.uid && c.batch != null && c.undoneAt == null)?.batch;
  if (batch != null) await app.must("undo_batch", { batch });
  const after = probe.get("staff", member.uid, keys);
  report.check("its undo puts them back", keys.every((k) => after[k] === before[k]));
}

/**
 * Freezing `player`'s positions holds every rating exactly: one the game lowers and one it raises are put back, while
 * the editor's own edit, and its undo, are what they are held at from then on. The squad's Frozen tag, the box under the
 * pitch in his profile and the team's box say so and work; a second copy of the app on the same data folder freezes them
 * again when it connects, and says so. Unfrozen, a changed rating stays.
 */
async function positions({ app, report, probe, club, player }) {
  const keys = (await app.must("edit_fields", { entity: "player" })).map((f) => f.key).filter((key) => key.startsWith("position."));
  const before = probe.get("player", player.uid, keys);
  // A position he plays best and one he hardly can: as if the game took the one away and taught him the other.
  const natural = keys.find((key) => before[key] === 20);
  const weak = keys.find((key) => before[key] <= 10);
  if (!natural || !weak) {
    report.skip("freezes a player's positions", `${player.name} rates 20 nowhere, or more than 10 everywhere`);
    return;
  }
  const lowered = 12;
  const raised = before[weak] + 9;
  const read = () => probe.get("player", player.uid, [natural, weak]);
  const frozenNow = async () => (await app.must("frozen_positions")).includes(player.uid);
  report.note(`witness: ${player.name} (${player.uid}), ${natural} ${before[natural]}, ${weak} ${before[weak]}`);
  try {
    const frozen = await app.must("freeze_positions", { uid: player.uid, frozen: true });
    report.check("freezes his positions", frozen.includes(player.uid));
    const file = join(app.folder, "data", "frozen.json");
    const saves = existsSync(file) ? Object.values(JSON.parse(readFileSync(file, "utf8")).saves) : [];
    report.check("remembers them in frozen.json", saves.some((save) => save.positions?.includes(player.uid)));

    probe.set("player", player.uid, natural, lowered);
    probe.set("player", player.uid, weak, raised);
    await sleep(HOLD);
    const held = read();
    report.check("puts back a rating the game lowered", held[natural] === before[natural], `${natural} changed to ${lowered}, reads ${held[natural]}`);
    report.check("and one it raised", held[weak] === before[weak], `${weak} changed to ${raised}, reads ${held[weak]}`);

    // The editor's own edit is what they are held at from then on, and so is its undo.
    const edited = before[weak] + 5;
    const applied = await app.must("apply_edits", { entity: "player", uid: player.uid, edits: [{ field: weak, value: edited }] });
    await sleep(HOLD);
    const kept = read()[weak];
    report.check("keeps the editor's own edit", applied.failed.length === 0 && kept === edited, `edited to ${edited}, reads ${kept}`);
    await app.must("undo_change", { id: applied.applied[0].id });
    await sleep(HOLD);
    const undone = read()[weak];
    report.check("and its undo", undone === before[weak], `reads ${undone}`);

    const row = (await app.must("club_squads", { uid: club.uid })).flatMap((team) => team.players).find((p) => p.uid === player.uid);
    report.check("his squad row says his positions are frozen", row?.positionsFrozen === true && !row.attributesFrozen && !row.fitnessFrozen,
      JSON.stringify(row && { positions: row.positionsFrozen, attributes: row.attributesFrozen, fitness: row.fitnessFrozen }));

    await throughTheSquad({ app, report, club, player, frozenNow });

    // A second copy of the app on the same data folder, as after a restart: connecting freezes them again.
    const again = await App.start({
      exe: app.exe,
      port: app.port + 2,
      folder: join(app.folder, "again"),
      env: { FMLIBRE_DATA: join(app.folder, "data") },
    });
    try {
      await again.connect();
      const notice = await again.waitFor(`document.querySelector(".frozen-notice")?.textContent`, "the notice", 10000).catch(() => "");
      report.check("a second start freezes them again, and says so", notice.includes(`Positions: ${player.name}`), notice);
      report.check("which holds him then", (await again.must("frozen_positions")).includes(player.uid));
      await again.shot("freeze-positions-again");
      report.check("no errors in the second copy's console", again.consoleProblems.length === 0, again.consoleProblems.slice(0, 3).join(" || "));
    } finally {
      again.close();
    }

    await app.must("freeze_positions", { uid: player.uid, frozen: false });
    report.check("unfreezes them", !(await frozenNow()));
    probe.set("player", player.uid, natural, lowered);
    await sleep(HOLD);
    const free = read()[natural];
    report.check("then leaves a changed rating alone", free === lowered, `reads ${free}`);
  } finally {
    for (const uid of await app.must("frozen_positions")) await app.invoke("freeze_positions", { uid, frozen: false });
    for (const key of [natural, weak]) probe.set("player", player.uid, key, before[key]);
    const after = read();
    report.check("his positions written back", after[natural] === before[natural] && after[weak] === before[weak], JSON.stringify(after));
  }
}

/**
 * With `player`'s positions frozen: the Frozen tag of his row in his club's squad, the box under the pitch in the
 * profile his name opens (unticked and ticked again, and its (i)), and the team's Freeze positions box, ticked for the
 * whole team and unticked; he is frozen again at the end.
 */
async function throughTheSquad({ app, report, club, player, frozenNow }) {
  await app.openClub(club.name, club.uid);
  await app.click(`[...document.querySelectorAll(".profile-tabs [role=tab]")].filter(${SHOWN})[1]`, "the Squad tab");
  await app.waitFor(`document.querySelector(".squad-tab tbody .squad-name button.name-link")`, "the squad's names", 30000);
  const row = `[...document.querySelectorAll(".squad-tab tbody tr")].find((tr) =>
    tr.querySelector(".squad-name button.name-link")?.textContent === ${JSON.stringify(player.name)})`;
  if (!(await app.js(`!!${row}`))) {
    report.skip("his profile's box under the pitch", `${player.name} is not in the team the Squad tab shows first`);
    return;
  }
  const tag = await app.js(`${row}.querySelector(".tag.frozen")?.title ?? ""`);
  report.check("his row's Frozen tag says his positions are", tag === "His positions are frozen", tag);

  await app.click(`${row}.querySelector(".squad-name button.name-link")`, `the name ${player.name}`);
  await app.waitFor(`${POPUP} && ${POPUP}.getAttribute("aria-busy") === "false"`, "his profile", 30000);
  const box = `${POPUP}.querySelector(".position-freeze input[type=checkbox]")`;
  await app.waitFor(box, "the box under the pitch");
  report.check("the box under the pitch is ticked", await app.js(`${box}.checked`));
  const placed = await app.js(`(() => {
    const box = ${POPUP}.querySelector(".position-freeze");
    const pitch = box.parentElement.querySelector("svg")?.getBoundingClientRect();
    const legend = box.parentElement.querySelector(".legend")?.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    return !!pitch && !!legend && pitch.bottom <= b.top + 1 && b.bottom <= legend.top + 1;
  })()`);
  report.check("it stands under the pitch, over the legend", placed);
  await app.click(box, "the box under the pitch");
  await app.waitFor(`!${box}.checked`, "the box to untick");
  report.check("unticking it unfreezes them", !(await frozenNow()));
  await app.click(box, "the box under the pitch");
  await app.waitFor(`${box}.checked`, "the box to tick");
  report.check("ticking it freezes them again", await frozenNow());

  await app.click(`${POPUP}.querySelector(".position-freeze .info-tip-button")`, "its (i)");
  const note = `${POPUP}.querySelector(".position-freeze .info-tip-note.shown")`;
  await app.waitFor(note, "the note");
  const shown = await app.js(`(() => {
    const b = ${note}.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), bottom: Math.round(b.bottom), width: innerWidth, height: innerHeight,
      text: ${note}.textContent };
  })()`);
  report.check("its (i) says what freezing positions does, within the window",
    shown.left >= 0 && shown.right <= shown.width && shown.text.includes("he does not learn a new position"), JSON.stringify(shown));
  await app.shot("freeze-positions");
  await app.press("Escape");
  await app.press("Escape");
  await app.waitFor(`!${POPUP}`, "the dialog to close", 5000);

  // The team's box: half ticked with him alone; ticked, it freezes the whole team, and unticked, none.
  const teamBox = `[...document.querySelectorAll(".squad-tab .squad-freezes label.freeze-toggle")]
    .find((label) => label.textContent.startsWith("Freeze positions"))?.querySelector("input")`;
  await app.waitFor(teamBox, "the team's Freeze positions box");
  report.check("the team's box is half ticked", await app.js(`${teamBox}.indeterminate && !${teamBox}.checked`));
  const team = async () =>
    (await app.must("club_squads", { uid: club.uid })).find((t) => t.players.some((p) => p.uid === player.uid))?.players ?? [];
  await app.click(teamBox, "Freeze positions");
  await app.waitFor(`${teamBox}.checked`, "the team's box to tick");
  const all = await team();
  report.check("ticked, it freezes the whole team", all.length > 0 && all.every((p) => p.positionsFrozen), `${all.filter((p) => p.positionsFrozen).length} of ${all.length}`);
  await app.click(teamBox, "Freeze positions");
  await app.waitFor(`!${teamBox}.checked && !${teamBox}.indeterminate`, "the team's box to untick");
  const none = await team();
  report.check("unticked, it unfreezes them all", none.every((p) => !p.positionsFrozen), `${none.filter((p) => p.positionsFrozen).length} left`);
  await app.must("freeze_positions", { uid: player.uid, frozen: true });
  await app.press("Escape");
}
