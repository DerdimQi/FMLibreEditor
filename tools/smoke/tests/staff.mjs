// Moving a member of staff to a club whose department is full, as most are once a save is loaded: the app grows the
// department's list, the probe reads him at the new club, and the undo puts him back. A new job in another department
// of his club, the same way. Then the jobs the editor gives since issue #120: a doctor (whose contract the game keeps
// as a basic one, with no dates) moved, a coach moved as a head performance analyst, a director of football moved to a
// club that has none and refused at one that has one, and a member of staff with no club signed as a coach under a
// contract taken from the game's own pool (skipped while the pool has no free slot, right after a load).
import { humanClubs, topClubs } from "../lib/witness.mjs";

export const name = "staff";
export const writes = true;

/** Coaching jobs the editor moves (see STAFF_JOBS in staff_move.rs), and a scout's, for a new job. */
const COACHING = [2, 20, 22, 26, 34, 60, 64];
const SCOUT = 14;
/** The jobs issue #120 asked for: a director of football, a chief doctor, a doctor, a head performance analyst. */
const DIRECTOR_OF_FOOTBALL = 10;
const DOCTORS = [38, 46];
const HEAD_PERFORMANCE_ANALYST = 62;
const COACH = 2;

/** The line the probe lists the member of staff `id` on: his name, job and club, by name. */
function probedClub(probe, id) {
  const line = probe.run(["staff", id]).split(/\r?\n/).find((l) => l.trimStart().startsWith(String(id)));
  return line?.replace(/\s+/g, " ").trim() ?? "";
}

/** The best member of staff with one of `jobs`, at a club no human manages, among the best `limit` staff. */
async function witness(app, jobs, human, limit = 400) {
  const staff = (await app.must("search_staff", { query: "", limit })).rows;
  return staff.find((m) => !m.isHuman && m.clubUid != null && !human.includes(m.clubUid) && jobs.includes(m.job));
}

export async function run({ app, report, probe }) {
  const human = await humanClubs(app);
  const clubs = await topClubs(app, 10);
  const coach = await witness(app, COACHING, human, 200);
  if (!coach) {
    report.skip("moves a coach to a club with a full department", "no coach at a club no human manages among the best staff");
    return;
  }
  const club = clubs.find((c) => c.uid !== coach.clubUid);
  report.note(`witness: ${coach.name} (${coach.uid}), ${coach.club} → ${club.name}`);
  const before = probedClub(probe, coach.uid);
  report.check("the probe reads him at his club", before.includes(coach.club.slice(0, 20)), before);

  const plan = await app.invoke("plan_staff_move", { uid: coach.uid, club: club.uid });
  report.check("the move is offered, the department full or not", plan.ok, plan.ok ? `${plan.value.from.name} → ${plan.value.to.name}` : plan.error.code);
  if (!plan.ok) return;
  const moved = await app.must("move_staff", { uid: coach.uid, club: club.uid });
  const after = probedClub(probe, coach.uid);
  report.check("moves him, as the probe reads it", after.includes(club.name.slice(0, 20)), after);
  await app.must("undo_change", { id: moved.id });
  const back = probedClub(probe, coach.uid);
  report.check("the undo puts him back", back === before, back);

  // A new job in another department of his club: a scout's.
  const job = await app.invoke("change_staff_job", { uid: coach.uid, job: SCOUT });
  report.check("gives him a scout's job at his club", job.ok, job.ok ? "" : job.error.code);
  if (job.ok) {
    report.check("as the probe reads it", /Scout/.test(probedClub(probe, coach.uid)), probedClub(probe, coach.uid));
    await app.must("undo_change", { id: job.value.id });
    report.check("and the undo gives him his job back", probedClub(probe, coach.uid) === before, probedClub(probe, coach.uid));
  }

  const jobs = await app.must("staff_jobs", {});
  const asked = [DIRECTOR_OF_FOOTBALL, ...DOCTORS, HEAD_PERFORMANCE_ANALYST];
  report.check("offers the jobs issue #120 asked for", asked.every((code) => jobs.includes(code)), jobs.join(", "));

  // Moving him as a head performance analyst: he leaves his department, and joins the new club's coaching staff.
  const asAnalyst = await app.invoke("move_staff", { uid: coach.uid, club: club.uid, job: HEAD_PERFORMANCE_ANALYST });
  report.check("moves him as a head performance analyst", asAnalyst.ok, asAnalyst.ok ? "" : asAnalyst.error.code);
  if (asAnalyst.ok) {
    const there = probedClub(probe, coach.uid);
    report.check("as the probe reads it", /Head Performance/.test(there) && there.includes(club.name.slice(0, 20)), there);
    await app.must("undo_change", { id: asAnalyst.value.id });
    report.check("and the undo puts him back as he was", probedClub(probe, coach.uid) === before, probedClub(probe, coach.uid));
  }

  await doctor(app, report, probe, human, clubs);
  await director(app, report, probe, human, clubs);
  await signing(app, report, probe, clubs);
}

/** A doctor, whose contract the game keeps as a basic one, moved and back. */
async function doctor(app, report, probe, human, clubs) {
  const member = await witness(app, DOCTORS, human, 2000);
  if (!member) {
    report.skip("moves a doctor", "no doctor at a club no human manages among the best staff");
    return;
  }
  const to = clubs.find((c) => c.uid !== member.clubUid);
  report.note(`doctor: ${member.name} (${member.uid}), ${member.club} → ${to.name}`);
  const before = probedClub(probe, member.uid);
  const moved = await app.invoke("move_staff", { uid: member.uid, club: to.uid });
  report.check("moves a doctor", moved.ok, moved.ok ? "" : moved.error.code);
  if (!moved.ok) return;
  report.check("as the probe reads it", probedClub(probe, member.uid).includes(to.name.slice(0, 20)), probedClub(probe, member.uid));
  await app.must("undo_change", { id: moved.value.id });
  report.check("and the undo puts the doctor back", probedClub(probe, member.uid) === before, probedClub(probe, member.uid));
}

/** A director of football: refused at a club that has one, moved to one that has none, and back. */
async function director(app, report, probe, human, clubs) {
  const staff = (await app.must("search_staff", { query: "", limit: 5000, filter: { job: DIRECTOR_OF_FOOTBALL } })).rows;
  const directed = new Set(staff.filter((m) => m.job === DIRECTOR_OF_FOOTBALL).map((m) => m.clubUid));
  const member = staff.find((m) => !m.isHuman && m.job === DIRECTOR_OF_FOOTBALL && m.clubUid != null && !human.includes(m.clubUid));
  if (!member) {
    report.skip("moves a director of football", "no director of football at a club no human manages");
    return;
  }
  const taken = clubs.find((c) => c.uid !== member.clubUid && directed.has(c.uid));
  const free = clubs.find((c) => c.uid !== member.clubUid && !directed.has(c.uid));
  report.note(`director of football: ${member.name} (${member.uid}), ${member.club}; taken ${taken?.name}, free ${free?.name}`);
  if (taken) {
    const refused = await app.invoke("plan_staff_move", { uid: member.uid, club: taken.uid });
    const said = refused.ok ? "offered" : `${refused.error.code} ${refused.error.params?.name ?? ""}`;
    report.check("refuses him at a club that has one, and names that one", !refused.ok && refused.error.code === "staff.directorTaken" && Boolean(refused.error.params?.name), said);
  }
  if (!free) {
    report.skip("moves a director of football to a club that has none", "every one of the best clubs has one");
    return;
  }
  const before = probedClub(probe, member.uid);
  const moved = await app.invoke("move_staff", { uid: member.uid, club: free.uid });
  report.check("moves him to a club that has none", moved.ok, moved.ok ? "" : moved.error.code);
  if (!moved.ok) return;
  const there = probedClub(probe, member.uid);
  report.check("as the probe reads it", there.includes(free.name.slice(0, 20)) && /Director of Football/.test(there), there);
  // The club he left has none now: another could be given the job there, and he could go back.
  await app.must("undo_change", { id: moved.value.id });
  report.check("and the undo puts him back", probedClub(probe, member.uid) === before, probedClub(probe, member.uid));
}

/** A member of staff with no club signed as a coach, and back. */
async function signing(app, report, probe, clubs) {
  const out = (await app.must("search_staff", { query: "", limit: 50, filter: { unemployed: true, women: false } })).rows;
  const member = out.find((m) => !m.isHuman);
  if (!member) {
    report.skip("signs a member of staff who has no club", "no one without a club");
    return;
  }
  const to = clubs[0];
  const refused = await app.invoke("plan_staff_move", { uid: member.uid, club: to.uid });
  report.check("asks for the job of one with no club", !refused.ok && refused.error.code === "staff.noJob", refused.ok ? "offered" : refused.error.code);
  const plan = await app.invoke("plan_staff_move", { uid: member.uid, club: to.uid, job: COACH, terms: {} });
  if (!plan.ok && plan.error.code === "sign.poolFull") {
    report.skip("signs a member of staff who has no club", "the game has no free contract slot yet: continue a day in the game");
    return;
  }
  report.check("offers the signing, with the contract made", plan.ok && plan.value.staffContract != null, plan.ok ? JSON.stringify(plan.value.staffContract) : plan.error.code);
  if (!plan.ok) return;
  report.note(`signing: ${member.name} (${member.uid}) → ${to.name} as a coach`);
  const signed = await app.must("move_staff", { uid: member.uid, club: to.uid, job: COACH, terms: {} });
  const there = probedClub(probe, member.uid);
  report.check("signs him, as the probe reads it", there.includes(to.name.slice(0, 20)) && /Coach/.test(there), there);
  await app.must("undo_change", { id: signed.id });
  const back = probedClub(probe, member.uid);
  report.check("and the undo leaves him with no club again", / - /.test(` ${back} `) || !back.includes(to.name.slice(0, 20)), back);
}
