import { useState } from "react";
import { call } from "./api";
import { ATTRIBUTE_LABELS, PERSONALITY_LABELS, positionLabel } from "./labels";
import type { ClubTeam, PlayerDetails, SquadPlayer } from "./types";

const escapeHtml = (value: unknown): string =>
  String(value ?? "—").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] ?? char);

const dateText = (date: { year: number; month: number; day: number } | null) =>
  date ? [date.year, String(date.month).padStart(2, "0"), String(date.day).padStart(2, "0")].join("-") : "—";

function table(rows: readonly [string, unknown][]) {
  return `<table><tbody>${rows.map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</tbody></table>`;
}

function playerCard(player: SquadPlayer, details: PlayerDetails | null): string {
  const attributes = details
    ? Object.entries(details.attributes).map(([key, value]) =>
        [ATTRIBUTE_LABELS[key as keyof typeof ATTRIBUTE_LABELS] ?? key, value.value] as [string, unknown])
    : [];
  const personality = details
    ? Object.entries(details.personality).map(([key, value]) =>
        [PERSONALITY_LABELS[key as keyof typeof PERSONALITY_LABELS] ?? key, value] as [string, unknown])
    : [];
  const positions = details
    ? Object.entries(details.positionRatings).map(([key, value]) => [positionLabel(key), value] as [string, unknown])
    : [];
  const summary: [string, unknown][] = [
    ["Yaş", player.age],
    ["Mevki", player.positions.map(positionLabel).join(", ") || "—"],
    ["Uyruk", player.nation],
    ["Kulüp", player.club],
    ["Forma numarası", details?.contract?.squadNumber],
    ["Sözleşme bitişi", dateText(details?.contract?.expires ?? player.contractExpires)],
    ["Haftalık ücret (£)", details?.contract?.wage],
    ["Sözleşme durumu", details?.contract?.squadStatus],
    ["Piyasa/istenen bedel (£)", details?.askingPrice],
    ["Boy (cm)", details?.heightCm],
    ["Kondisyon (%)", details ? (details.condition / 100).toFixed(1) : null],
    ["Maç keskinliği (%)", details ? (details.matchSharpness / 100).toFixed(1) : null],
    ["Moral", details?.morale],
    ["Yorgunluk", details?.jadedness],
    ["Uluslararası maç", details?.international.caps],
    ["Uluslararası gol", details?.international.goals],
    ["Sakatlık sayısı", details?.injuries.length],
    ["Ceza sayısı", details?.bans.length],
    ["Kiralık", details?.loan ? details.loan.club ?? "Evet" : "Hayır"],
  ];
  const extra = details ? {
    traits: details.traits,
    injuries: details.injuries,
    bans: details.bans,
    ties: details.ties,
    contractClauses: details.contract?.clauses ?? [],
    contractConcerns: details.contract?.concerns ?? [],
    retirement: details.retirementKnown ? dateText(details.retires) : "Bilinmiyor",
  } : null;
  return `<article class="player"><header><h2>${escapeHtml(player.name)}</h2><span>${escapeHtml(player.positions.map(positionLabel).join(" / "))}</span></header>
    ${table(summary)}
    ${details ? `<h3>Özellikler</h3>${table(attributes)}<h3>Kişilik</h3>${table(personality)}<h3>Mevki yeterlilikleri</h3>${table(positions)}
      <details><summary>Diğer profil ayrıntıları</summary><pre>${escapeHtml(JSON.stringify(extra, null, 2))}</pre></details>`
      : '<p class="warning">Bu oyuncunun ayrıntılı profili okunamadı; kadro ekranındaki bilgiler rapora eklendi.</p>'}
  </article>`;
}

/** Downloads a self-contained HTML report for the currently selected squad. */
export function SquadHtmlExport({ team, clubName }: { team: ClubTeam; clubName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    if (busy || team.players.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        team.players.map((player) => call<PlayerDetails>("player_details", { uid: player.uid })),
      );
      const cards = team.players.map((player, index) => {
        const result = results[index];
        return playerCard(player, result.status === "fulfilled" ? result.value : null);
      });
      const title = `${clubName} — ${team.ageLimit ? `U${team.ageLimit}` : team.index === 0 ? "A Takım" : `Takım ${team.index + 1}`} Kadro Raporu`;
      const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
      <style>
      :root{color-scheme:light;--ink:#17202b;--muted:#657184;--line:#dce2e9;--paper:#f4f6f8;--accent:#245c85}
      *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
      main{max-width:1100px;margin:auto;padding:36px 22px}h1{font-size:30px;margin:0}h2{font-size:21px;margin:0}h3{font-size:16px;margin:24px 0 8px}
      .meta{color:var(--muted);margin:8px 0 26px}.player{background:white;border:1px solid var(--line);border-radius:12px;padding:22px;margin:16px 0;break-inside:avoid}
      .player header{display:flex;justify-content:space-between;gap:16px;align-items:center;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:12px}
      .player header span{color:var(--accent);font-weight:650}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
      th{width:42%;color:var(--muted);font-weight:550}details{margin-top:18px}summary{cursor:pointer;color:var(--accent);font-weight:650}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7fa;padding:14px;border-radius:8px;font-size:12px}
      .warning{color:#8a4b00;background:#fff6e7;padding:10px;border-radius:7px}.foot{color:var(--muted);font-size:12px;margin-top:28px}
      @media print{body{background:white}main{padding:0 10px}.player{border-color:#bbb;box-shadow:none}}
      </style></head><body><main><h1>${escapeHtml(title)}</h1><p class="meta">${team.players.length} oyuncu · Oluşturulma: ${new Date().toLocaleString("tr-TR")}</p>
      ${cards.join("")}<p class="foot">FMLibreEditor tarafından oluşturuldu. CA/PA değerleri rapora dahil edilmedi.</p></main></body></html>`;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${clubName.replace(/[^a-z0-9-_]+/gi, "-")}-kadro-raporu.html`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return <div className="squad-html-export">
    <button type="button" onClick={() => void download()} disabled={busy || team.players.length === 0}>
      {busy ? "Rapor hazırlanıyor…" : "HTML kadro raporu indir"}
    </button>
    {error && <span role="alert" className="error">{error}</span>}
  </div>;
}
