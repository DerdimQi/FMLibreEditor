// A player opened from a club's squad, as a dialog over it: focus kept in it, Escape (on an (i) button the note's
// first, then the dialog's), the Transfer dialog over it, and the question before unapplied edits are thrown away.
// Writes nothing.
import { SHOWN, VIS, sleep } from "../lib/app.mjs";
import { topClubs } from "../lib/witness.mjs";

export const name = "dialog";
export const writes = false;

const POPUP = `document.querySelector(".modal-backdrop .profile.popup")`;

export async function run({ app, report }) {
  const [club] = await topClubs(app, 1);
  await app.openClub(club.name, club.uid);
  await app.click(`[...document.querySelectorAll(".profile-tabs [role=tab]")].filter(${SHOWN})[1]`, "the Squad tab");
  const names = `[...document.querySelectorAll(".squad-tab tbody .squad-name button.name-link")]`;
  await app.waitFor(`${names}.length > 0`, "the squad's names", 30000);
  const player = await app.js(`${names}[0].textContent`);
  const nameButton = `${names}.find((b) => b.textContent === ${JSON.stringify(player)})`;
  const focusInPopup = () =>
    app.js(`(() => { const p = ${POPUP}; return !!p && (document.activeElement === p || p.contains(document.activeElement)); })()`);
  const open = async () => {
    await app.click(nameButton, `the name ${player}`);
    await app.waitFor(`${POPUP} && ${POPUP}.getAttribute("aria-busy") === "false"`, "the dialog", 30000);
    await sleep(300);
  };
  const logLength = async () => (await app.must("change_log")).length;
  const logBefore = await logLength();

  await open();
  const shown = await app.js(`(() => { const p = ${POPUP};
    return { modal: p.getAttribute("aria-modal"), role: p.getAttribute("role"), name: p.querySelector("h2")?.textContent }; })()`);
  report.check("the name opens a modal dialog", shown.modal === "true" && shown.role === "dialog" && shown.name?.includes(player),
    JSON.stringify(shown));
  report.check("the focus is in the dialog", await focusInPopup());
  let outside = 0;
  for (let i = 0; i < 25; i++) {
    await app.press("Tab");
    if (!(await focusInPopup())) outside++;
  }
  report.check("Tab keeps the focus in the dialog", outside === 0, `${outside} of 25 outside`);
  await app.shot("dialog");

  // Where the Tabs end depends on how many buttons the player's dialog has. On an (i) button, whose note shows while
  // the button has the keyboard's focus, the first Escape is the note's: it hides the note and nothing else, as a note
  // shown on focus must go away without the focus moving (WCAG 1.4.13; see InfoTip and useModal). So Tab on to the
  // first (i) button there is, and check both Escapes from there: the note's, then the dialog's.
  const onTip = `${POPUP}.contains(document.activeElement) && document.activeElement.matches(".info-tip-button")`;
  const stops = await app.js(`${POPUP}.querySelectorAll("a[href], button, input, select, textarea, summary, [tabindex]").length`);
  for (let i = 0; i < stops && !(await app.js(onTip)); i++) {
    await app.press("Tab");
  }
  if (await app.js(onTip)) {
    const tip = await app.js(`document.activeElement.getAttribute("aria-label")`);
    report.check("an (i) button shows its note while it has the focus",
      await app.js(`!!document.activeElement.closest(".info-tip[data-open-tip]")`), tip);
    await app.press("Escape");
    await sleep(300);
    report.check("Escape there hides only the note: the dialog and the focus stay",
      await app.js(`!!${POPUP} && !${POPUP}.querySelector("[data-open-tip]") && ${onTip}`), tip);
  } else {
    report.skip("Escape on an (i) button hides only its note", "Tab reaches no (i) button in the dialog");
  }

  await app.press("Escape");
  await app.waitFor(`!${POPUP}`, "the dialog to close", 5000);
  const back = await app.js(`document.activeElement?.classList.contains("name-link") ? document.activeElement.textContent : ""`);
  report.check("Escape closes it and gives the focus back to the name", back === player, `focus on "${back}"`);

  await open();
  await app.click(`${POPUP}.querySelector(".move-toggle")`, "Transfer");
  await app.waitFor(`document.querySelector(".move-dialog")`, "the Transfer dialog");
  await sleep(300);
  report.check("Transfer opens over the dialog, with the focus", await app.js(`document.querySelector(".move-dialog").contains(document.activeElement)`));
  await app.press("Escape");
  await app.waitFor(`!document.querySelector(".move-dialog")`, "the Transfer dialog to close", 5000);
  report.check("Escape closes only the Transfer dialog", await app.js(`!!${POPUP}`));

  await app.click(`${POPUP}.querySelector(".edit-toggle")`, "Edit");
  await app.waitFor(`${POPUP}.classList.contains("editing") && ${POPUP}.querySelector("input.edit-input")`, "the inputs");
  const field = await app.js(`(() => {
    const inputs = [...${POPUP}.querySelectorAll("input.edit-input")];
    const input = inputs.find((el) => /^\\d+$/.test(el.value) && +el.value >= 1 && +el.value <= 19);
    if (!input) return null;
    input.setAttribute("data-smoke", "1");
    return { label: input.getAttribute("aria-label"), value: Number(input.value) };
  })()`);
  if (!field) {
    report.check("an input to type in", false, "no small number among the inputs");
  } else {
    await app.setInput(`${POPUP}.querySelector("[data-smoke]")`, field.value + 1);
    await app.waitFor(`${POPUP}.querySelector(".edit-count.pending")`, "the pending change");
    await app.press("Escape");
    await sleep(300);
    report.check("Escape with a change asks first", await app.js(`!!${POPUP}?.querySelector(".edit-footer button.danger")`),
      `${field.label}: ${field.value} → ${field.value + 1}`);
    await app.click(`${POPUP}.querySelector(".edit-footer button.danger")`, "Discard");
    await app.waitFor(`!${POPUP} || !${POPUP}.classList.contains("editing")`, "the edits to be thrown away", 5000);
    if (await app.js(`!!${POPUP}`)) {
      await app.press("Escape");
      await app.waitFor(`!${POPUP}`, "the dialog to close", 5000);
    }
    report.check("Discard throws the change away and writes nothing", (await logLength()) === logBefore);
  }
  if (await app.js(`!!${VIS}(".profile:not(.popup)")`)) {
    await app.press("Escape");
  }
}
