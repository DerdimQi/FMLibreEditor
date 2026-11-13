import { useEffect, useState } from "react";
import { call } from "./api";
import { ATTRIBUTE_LABELS, PERSONALITY_LABELS, positionLabel, POSITION_LABELS, teamLabel } from "./labels";
import type { ClubTeam, PlayerDetails, SquadPlayer } from "./types";

type Cell = string | number | boolean | null;
type Row = Cell[];

const xml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[c] ?? c);

const dateText = (date: { year: number; month: number; day: number } | null | undefined) =>
  date ? [date.year, String(date.month).padStart(2, "0"), String(date.day).padStart(2, "0")].join("-") : "";

const colName = (n: number) => {
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
};

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; content: string }[]) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => [v & 255, (v >>> 8) & 255];
  const u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const join = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  };
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = join([
      new Uint8Array([0x50,0x4b,0x03,0x04,20,0,0,0,0,0,0,0,0,0]),
      new Uint8Array(u32(crc)), new Uint8Array(u32(data.length)), new Uint8Array(u32(data.length)),
      new Uint8Array(u16(name.length)), new Uint8Array([0,0]), name, data,
    ]);
    chunks.push(local);
    const directory = join([
      new Uint8Array([0x50,0x4b,0x01,0x02]),
      new Uint8Array([20,0,20,0,0,0,0,0,0,0,0,0]),
      new Uint8Array(u32(crc)), new Uint8Array(u32(data.length)), new Uint8Array(u32(data.length)),
      new Uint8Array(u16(name.length)), new Uint8Array([0,0,0,0,0,0,0,0]),
      new Uint8Array(u32(0)), new Uint8Array(u32(offset)), name,
    ]);
    central.push(directory);
    offset += local.length;
  }
  const directory = join(central);
  const end = new Uint8Array([
    0x50,0x4b,0x05,0x06,0,0,0,0,
    ...u16(files.length), ...u16(files.length), ...u32(directory.length), ...u32(offset), 0,0,
  ]);
  return new Blob([join([...chunks, directory, end])], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function worksheet(rows: Row[], widths: number[], headerRow = 1) {
  const lastCol = colName(Math.max(1, widths.length));
  const lastRow = Math.max(1, rows.length);
  const cols = widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("");
  const sheetRows = rows.map((row, ri) => {
    const cells = row.map((value, ci) => {
      if (value === null || value === undefined || value === "") return "";
      const ref = `${colName(ci + 1)}${ri + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" s="${ri === headerRow - 1 ? 1 : 0}"><v>${value}</v></c>`;
      if (typeof value === "boolean") return `<c r="${ref}" t="b" s="${ri === headerRow - 1 ? 1 : 0}"><v>${value ? 1 : 0}</v></c>`;
      return `<c r="${ref}" t="inlineStr" s="${ri === headerRow - 1 ? 1 : 0}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join("");
  const autoFilter = rows.length >= headerRow ? `<autoFilter ref="A${headerRow}:${lastCol}${lastRow}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols><sheetData>${sheetRows}</sheetData>${autoFilter}
</worksheet>`;
}

function playerRow(player: SquadPlayer, details: PlayerDetails | null, teamName: string): Row {
  const contract = details?.contract;
  const base: Cell[] = [
    player.name, player.fullName ?? null, teamName, player.age ?? null, player.positions.map(positionLabel).join(", "),
    player.nation ?? null, player.club ?? null, dateText(player.dateOfBirth),
    player.condition / 100, player.matchSharpness / 100, player.jadedness, player.morale,
    player.cohesion ?? null, player.tactics ?? null, details?.heightCm ?? null, details?.askingPrice ?? null,
    contract?.squadNumber ?? null, contract?.wage ?? null, dateText(contract?.expires ?? player.contractExpires),
    contract?.squadStatus ?? null, contract?.happiness ?? null, contract?.playingTimeHappiness ?? null,
    details?.international.caps ?? null, details?.international.goals ?? null,
    details?.injuries.map((x) => x.name ?? "").filter(Boolean).join("; ") ?? "",
    details?.bans.map((x) => String(x.matches)).join("; ") ?? "",
    details?.loan?.club ?? (player.loan === "out" ? "Kiralık" : ""),
    details?.loan?.parent ?? null, details?.loan?.until ? dateText(details.loan.until) : "",
    details?.traits.join(", ") ?? "", details?.ties.map((x) => x.name ?? "").filter(Boolean).join("; ") ?? "",
    contract?.transferListed ?? null, contract?.loanListed ?? null,
  ];
  const attributes = Object.keys(ATTRIBUTE_LABELS).map((key) => details?.attributes[key]?.value ?? null);
  const personality = Object.keys(PERSONALITY_LABELS).map((key) => details?.personality[key] ?? null);
  const positions = Object.keys(POSITION_LABELS).map((key) => details?.positionRatings[key] ?? null);
  return [...base, ...attributes, ...personality, ...positions];
}

const BASE_HEADERS = [
  "Oyuncu", "Tam ad", "Takım", "Yaş", "Mevkiler", "Uyruk", "Kulüp", "Doğum tarihi",
  "Kondisyon %", "Maç keskinliği %", "Yorgunluk", "Moral",
  "Takım uyumu", "Taktik aşinalığı", "Boy (cm)", "İstenen bonservis (£)", "Forma no",
  "Haftalık ücret (£)", "Sözleşme bitişi", "Kadro statüsü", "Mutluluk", "Forma süresi mutluluğu",
  "Milli maç", "Milli gol", "Sakatlıklar", "Cezalar", "Kiralık olduğu kulüp", "Bonservisinin olduğu kulüp",
  "Kiralık bitişi", "Özel hareketler (kod)", "Uyruk / yetişme bağları", "Transfer listesinde", "Kiralık listesinde",
];

const EXPORT_GROUPS = [
  { id: "base", label: "Oyuncu bilgileri", columns: BASE_HEADERS.map((label, index) => ({ key: `base-${index}`, label })) },
  { id: "attributes", label: "Oyuncu özellikleri", columns: Object.keys(ATTRIBUTE_LABELS).map((key) => ({ key: `attribute-${key}`, label: ATTRIBUTE_LABELS[key as keyof typeof ATTRIBUTE_LABELS] })) },
  { id: "personality", label: "Kişilik", columns: Object.keys(PERSONALITY_LABELS).map((key) => ({ key: `personality-${key}`, label: PERSONALITY_LABELS[key as keyof typeof PERSONALITY_LABELS] })) },
  { id: "positions", label: "Mevki yetkinlikleri", columns: Object.keys(POSITION_LABELS).map((key) => ({ key: `position-${key}`, label: `Mevki: ${POSITION_LABELS[key as keyof typeof POSITION_LABELS]}` })) },
] as const;

const DEFAULT_EXPORT_COLUMNS = EXPORT_GROUPS.flatMap((group) => group.columns).map((column) => column.key);

const EXPORT_COLUMNS_STORAGE_KEY = "fmlibreeditor.squadExcelColumns.v2";
const ALL_EXPORT_COLUMN_KEYS = EXPORT_GROUPS.flatMap((group) => group.columns.map((column) => column.key));

function savedExportColumns(): string[] {
  try {
    const saved = window.localStorage.getItem(EXPORT_COLUMNS_STORAGE_KEY);
    if (!saved) return [...DEFAULT_EXPORT_COLUMNS];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [...DEFAULT_EXPORT_COLUMNS];
    return parsed.filter((key): key is string =>
      typeof key === "string" && ALL_EXPORT_COLUMN_KEYS.includes(key));
  } catch {
    return [...DEFAULT_EXPORT_COLUMNS];
  }
}

function safeSheetName(name: string, used: Set<string>) {
  const base = name.replace(/[\\/?*:[\]]/g, " ").slice(0, 31) || "Takım";
  let candidate = base, n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` ${n++}`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function buildWorkbook(clubName: string, teams: readonly ClubTeam[], details: (PlayerDetails | null)[][], selectedColumns: ReadonlySet<string>) {
  const used = new Set<string>();
  const names = ["Kulüp Özeti", ...teams.map((team) => safeSheetName(teamLabel(team), used))];
  const summary: Row[] = [[clubName, "Kulüp kadro raporu", "Oluşturulma", new Date().toLocaleString("tr-TR")], [], ["Takım", "Oyuncu sayısı", "Ortalama yaş", "Kaptan", "Kaptan yardımcısı"]];
  teams.forEach((team) => {
    const ages = team.players.flatMap((p) => p.age === null ? [] : [p.age]);
    summary.push([
      teamLabel(team), team.players.length,
      ages.length ? Number((ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1)) : null,
      team.players.find((p) => p.uid === team.captain)?.name ?? "",
      team.players.find((p) => p.uid === team.viceCaptain)?.name ?? "",
    ]);
  });
  const sheets = [worksheet(summary, [28, 18, 18, 28, 28], 3)];
  teams.forEach((team, ti) => {
    const allHeaders = EXPORT_GROUPS.flatMap((group) => group.columns);
    const selectedIndexes = allHeaders.flatMap((column, index) => selectedColumns.has(column.key) ? [index] : []);
    const headers = selectedIndexes.map((index) => allHeaders[index].label);
    const rows: Row[] = [headers];
    team.players.forEach((player, pi) => {
      const fullRow = playerRow(player, details[ti][pi], teamLabel(team));
      rows.push(selectedIndexes.map((index) => fullRow[index]));
    });
    sheets.push(worksheet(rows, headers.map((h) => Math.max(13, Math.min(26, h.length + 3)))));
  });
  const files = [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf xfId="0" fontId="0" fillId="0" borderId="0"/><xf xfId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>` },
    ...sheets.map((content, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content })),
  ];
  return zip(files);
}

export function SquadExcelExport({ teams, clubName }: { teams: readonly ClubTeam[]; clubName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(savedExportColumns);
  const [columnSearch, setColumnSearch] = useState("");
  const normalizedSearch = columnSearch.trim().toLocaleLowerCase("tr-TR");
  const visibleGroups = EXPORT_GROUPS.map((group) => ({
    ...group,
    columns: group.columns.filter((column) =>
      !normalizedSearch || column.label.toLocaleLowerCase("tr-TR").includes(normalizedSearch)),
  })).filter((group) => group.columns.length > 0);
  useEffect(() => {
    try {
      window.localStorage.setItem(EXPORT_COLUMNS_STORAGE_KEY, JSON.stringify(selectedColumns));
    } catch {
      // The export still works when the environment does not allow local storage.
    }
  }, [selectedColumns]);
  const totalColumns = EXPORT_GROUPS.reduce((count, group) => count + group.columns.length, 0);
  const selectedSet = new Set(selectedColumns);
  const setVisibleGroup = (keys: string[], checked: boolean) => {
    setSelectedColumns((current) => {
      const next = new Set(current);
      keys.forEach((key) => checked ? next.add(key) : next.delete(key));
      return [...next];
    });
  };
  const toggleColumn = (key: string, checked: boolean) => {
    setSelectedColumns((current) => checked
      ? current.includes(key) ? current : [...current, key]
      : current.filter((item) => item !== key));
  };
  const download = async () => {
    if (busy || teams.every((team) => team.players.length === 0) || selectedColumns.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const allDetails = await Promise.all(teams.map(async (team) => Promise.allSettled(
        team.players.map((player) => call<PlayerDetails>("player_details", { uid: player.uid })),
      )));
      const details = allDetails.map((results) => results.map((result) =>
        result.status === "fulfilled" ? result.value : null));
      const blob = buildWorkbook(clubName, teams, details, selectedSet);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${clubName.replace(/[^a-z0-9-_]+/gi, "-")}-kadro-raporu.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return <div className="squad-excel-export">
    <details className="squad-excel-options">
      <summary>Excel raporunda bulunacak alanları seç ({selectedColumns.length}/{totalColumns})</summary>
      <div className="squad-excel-options-actions">
        <button type="button" onClick={() => setSelectedColumns(EXPORT_GROUPS.flatMap((group) => group.columns.map((column) => column.key)))}>
          Tümünü seç
        </button>
        <button type="button" onClick={() => setSelectedColumns([])}>Temizle</button>
        <button type="button" onClick={() => setSelectedColumns([...DEFAULT_EXPORT_COLUMNS])}>Varsayılana dön</button>
      </div>
      <label className="squad-excel-search">
        <span>Sütunlarda ara</span>
        <input
          type="search"
          value={columnSearch}
          onChange={(event) => setColumnSearch(event.currentTarget.value)}
          placeholder="Örn. maaş, hızlanma, pas…"
          aria-label="Excel sütunlarında ara"
        />
      </label>
      <div className="squad-excel-options-groups">
        {visibleGroups.length === 0 && <p className="note">Aramanla eşleşen sütun bulunamadı.</p>}
        {visibleGroups.map((group) => {
          const selectedInGroup = group.columns.filter((column) => selectedSet.has(column.key)).length;
          const visibleKeys = group.columns.map((column) => column.key);
          return <fieldset key={group.id} className="squad-excel-options-group">
            <legend>{group.label} ({selectedInGroup}/{group.columns.length} eşleşen)</legend>
            <label className="squad-excel-group-toggle">
              <input
                type="checkbox"
                checked={selectedInGroup === group.columns.length}
                ref={(element) => { if (element) element.indeterminate = selectedInGroup > 0 && selectedInGroup < group.columns.length; }}
                onChange={(event) => setVisibleGroup(visibleKeys, event.currentTarget.checked)}
              />
              Görünenleri seç
            </label>
            <div className="squad-excel-options-columns">
              {group.columns.map((column) => <label key={column.key}>
                <input
                  type="checkbox"
                  checked={selectedSet.has(column.key)}
                  onChange={(event) => toggleColumn(column.key, event.currentTarget.checked)}
                />
                {column.label}
              </label>)}
            </div>
          </fieldset>;
        })}
      </div>
    </details>
    <button type="button" onClick={() => void download()} disabled={busy || teams.every((team) => team.players.length === 0) || selectedColumns.length === 0}>
      {busy ? "Excel hazırlanıyor…" : "Excel kulüp raporu indir (.xlsx)"}
    </button>
    {selectedColumns.length === 0 && <span className="note">En az bir sütun seçmelisin.</span>}
    {error && <span role="alert" className="error">{error}</span>}
  </div>;
}
