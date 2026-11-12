// Max tactics for the senior team of the club the human manager has, read back and undone as one batch. It is the
// one test that writes to the human manager's own players: nobody else's tactic is one he picks.
import { humanClubs, topClubs } from "../lib/witness.mjs";

export const name = "tactics";
export const writes = true;

/** How well each player of the club's senior team knows its tactic, by UID; none for those the app reads none for. */
async function familiarity(app, uid) {
  const [senior] = await app.must("club_squads", { uid });
  return new Map(senior.players.filter((p) => p.tactics != null).map((p) => [p.uid, p]));
}

export async function run({ app, report, probe }) {
  const [other] = await topClubs(app, 1);
  const unpicked = await familiarity(app, other.uid);
  report.check("reads none for a team whose tactic no human picks", unpicked.size === 0, `${other.name}: ${unpicked.size} players`);

  const [club] = await humanClubs(app);
  if (club == null) {
    report.skip("reads how well the human manager's team knows its tactic", "the human manager has no club on this save");
    return;
  }
  const before = await familiarity(app, club);
  const values = (players) => [...players.values()].map((p) => `${p.tactics}${p.trains ? "" : "*"}`).join(" ");
  report.check("reads how well the human manager's team knows its tactic", before.size > 0, `club ${club}: ${values(before)}`);
  if (before.size === 0) return;

  const written = await app.must("team_action", { club, team: 0, action: "maxTactics" });
  const after = await familiarity(app, club);
  const short = [...after.values()].filter((p) => p.playsHere && p.trains && p.tactics !== 100);
  report.check("Max tactics writes without a refusal", written.failed.length === 0, JSON.stringify(written.failed.slice(0, 3)));
  report.check(
    "every player who trains then knows it at its best",
    written.applied > 0 && short.length === 0,
    `${written.applied} written; ${values(after)}${short.length ? `; short: ${short.map((p) => p.name).join(", ")}` : ""}`,
  );
  const fallen = [...after.values()].filter((p) => p.tactics < before.get(p.uid)?.tactics);
  report.check("nobody knows it less than before", fallen.length === 0, fallen.map((p) => p.name).join(", "));
  const held = probe.run(["health"]).split(/\r?\n/).find((line) => /\btactics\b/.test(line)) ?? "";
  report.check("the records and histories still check out", /^\s*pass\b/.test(held), held.trim());

  // Undone newest first, as the Changes tab undoes a batch.
  const log = (await app.must("change_log")).filter((change) => change.batch === written.batch && change.undoneAt == null);
  const refused = [];
  for (const change of log.reverse()) {
    const undone = await app.invoke("undo_change", { id: change.id });
    if (!undone.ok) refused.push(`${change.name}: ${JSON.stringify(undone.error)}`);
  }
  const again = await familiarity(app, club);
  const changed = [...before.values()].filter((p) => again.get(p.uid)?.tactics !== p.tactics || again.get(p.uid)?.trains !== p.trains);
  report.check("the undo puts every player back", refused.length === 0 && changed.length === 0, [...refused, ...changed.map((p) => p.name)].join("; "));
  const restored = probe.run(["health"]).split(/\r?\n/).find((line) => /\btactics\b/.test(line)) ?? "";
  report.check("and they check out after the undo", /^\s*pass\b/.test(restored), restored.trim());
}
