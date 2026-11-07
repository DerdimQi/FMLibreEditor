# FM27: staff jobs, where clubs keep their staff, and staff contracts

Read on the Windows Game Pass build 0.9.2409.0, on a save of 17 November 2026 (59,305 players, 29,569 staff, 31,227
clubs), for issue #120: some jobs had no name in the editor (Head Performance Analyst, Director of Football, the
doctors), their staff could not be moved, and staff with no club could not be signed.

## Job codes

A contract's job is a `u8` at `+0x26` (`[contract] job`); a player-coach has the code of his coaching job plus one.
The game's English names come from its own text, which the install carries in full as
`data/game_simulation/templates/user_folder/languages/example.ltf` (each string with its key and a comment, such as
`KEY-412812: Chief Doctor[COMMENT: job title; FR 15703]`), and in every language in `languages.fmf` (zstd frames one after
another; decoded and searched, they give the Turkish and Spanish names in the same order). Which code is which job comes
from who holds it, and how many each club has:

| Code | Job | Holders | Per club | Seen holding it |
|---|---|---|---|---|
| 38 | Chief Doctor (TR Sağlık Ekibi Sorumlusu, ES Médico jefe) | 307 | 1 at 297 clubs, 2 at 5 | Ricard Pruna (Barcelona), Max Sala (Manchester City), José María Villalón (Atlético), Niko Mihić (Real Madrid) |
| 46 | Doctor (Doktor, Médico) | 436 | up to 9 (Lecce), 7 at Juventus | Eduardo Mauri (Manchester City), Óscar Celada (Atlético) |
| 62 | Head Performance Analyst (Kıdemli Performans Analisti, Analista jefe de rendimiento) | 205 | exactly 1 | Harry Dunn (Manchester City), Ben Chadwick (Arsenal), Michael Niemeyer (Bayern) |
| 66 | Owner (Kulübün Sahibi, Propietario) | 143 | mostly 1 | John Henry (Liverpool), Al Waleed bin Talal (Al Hilal), Peter Holt (San Antonio FC) |
| 8 | not told apart yet: a chief executive's (Managing Director?) | 183 | mostly 1 | Ferran Soriano, David Hopkinson (Newcastle), José Ángel Sánchez (Real Madrid) |
| 24 | not told apart yet | 5 | 1 | at Famalicão, Estoril, Sparta Rotterdam |

The other codes the editor names (2 Coach, 10 Director of Football, 12 Physio, ..., 88 Technical Director) are in
`job_name` in `staff.rs`.

## Where a club keeps its staff

`fmlibre-probe staff-places` counts, job by job, which of the club's department lists hold its staff (`M`edical
`+0x60`, `C`oaching `+0x78`, `S`couting `+0x90`), and at which offsets the club (its first `0x400` bytes) or one of its
teams (`0x800`) points at them itself:

- Chief doctors and doctors: all in the medical list (307 and 436). Head performance analysts: the coaching list (199,
  6 in coaching and scouting). Loan managers (89 + 2) and technical directors (223 + 5): the scouting list. So these move
  as other staff do; until issue #120 the editor only had no name for the first three and did not give these jobs.
- Directors of football (job 10): 350 of 362 in no list, and every one of them held by his club at `+0x148`
  (`[club] director_of_football`). `staff-places --club-offset 0x148` reads that place of every club: null at 30,831,
  a director of football at each of the 362 clubs that have one, and at 34 more someone else who does that job too
  (25 managers, 4 directors, 2 presidents, a goalkeeping coach, a head of youth development, a recruitment analyst),
  always of that club. The place holds the member of staff's object, not his person block.
- Managers: held by their team at `+0x80` (3,056 at a senior team, the rest at youth and reserve teams). The board
  (chairpersons, directors, presidents, owners, codes 8 and 24): in no list and held by neither the club nor a team in
  those bytes. These are left to the game.

A move takes a director of football out of his club's place and puts him in the new club's, which must be empty: the
game has no club with two, and a club with one refuses another (`staff.directorTaken`, naming him). Given another job,
he leaves the place and joins that job's department; given the job, a member of staff leaves his departments and takes
his club's place, if it is empty. A club whose place holds someone who is not a director of football by job (a manager
who does the job too) leaves him to the game.

## Staff contracts

`fmlibre-probe contract-classes` counts the classes of the contracts: every one of the 53,396 players' contracts is a
`db::FULL_CONTRACT` (200 bytes), but of the staff's, 14,925 are and 2,271 are `db::BASIC_CONTRACT`: the board, and most
doctors (303 of 307 chief doctors, 432 of 436 doctors). A basic contract is 40 bytes, packed one after another: the
owner (`+0x08`), the team and senior team (`+0x10`, `+0x18`), the wage (`+0x20`, 0 for most doctors), a `u16` at
`+0x24` and the job (`+0x26`). It has no dates. A move of a member of staff writes only those fields of a basic
contract, never the dates a full one has at `+0x44` and `+0x4C` (which, 0x28 bytes on, are the next contract's).

`+0xA0` of a full staff contract (`staff-places --contract-offset 0xA0`) is zero for most and the contract's own team
for a few hundred (Jonathan Power, Liverpool's chief doctor; Conall Murtagh, their fitness coach); a move leaves it.

## Signing a member of staff with no club

As a free agent's (see `fm27-object-pools.md`): a slot of the game's pool of full contracts holds a copy of the full
contract of the member of the club's staff whose job is the one given (else one in the same department, else any),
nearest his current ability; his own owner, the club's senior team as his team and senior team, the job, signed and
joined today, the end date given or 30 June at the end of next season, the wage given or the model's, no loyalty bonus,
squad number, listing, unhappiness, clauses or bonuses, and zero at `+0x28`, `+0x98` and `+0xA0`. He joins the job's
department (grown when full) or the club's place for a director of football (if empty), and his object's contract
(`+0x1A8`) points at the slot. The undo takes it all back, the slot free again and first in the pool's chain.

Right after a save is loaded the pool has no free slot (70,826 used, 0 free on this save), and the signing is refused
until the game makes a contract itself, as it does when the days go by.

## Checked

With the probe on Game Pass 0.9.2409.0, each undone: Óscar Celada (doctor, basic contract) Atlético → Tottenham;
Jonathan Power (chief doctor) Liverpool → Tottenham as a doctor; Ben Chadwick (head performance analyst) Arsenal →
Tottenham; Deco (director of football) Barcelona → Real Madrid, refused at Liverpool (Julian Ward), to Liverpool as a
technical director, and a technical director at Barcelona; Juni Calafat (chief scout) made Real Madrid's director of
football, and refused as Barcelona's. Afterwards `staff-places --club-offset 0x148` read as before.

Two days on (19 November 2026), the game had made contracts and taken a second chunk of 1,024 slots (1,019 free), and
signings went through, each undone with the pool read back as before: Jürgen Klopp to Tottenham as a coach (£7,746 a
week, the model's, to 30 June 2028); Rodolfo Borrell to Tottenham as a doctor (the medical list grown); Txiki
Begiristain to Real Madrid as director of football, and refused at Liverpool; Carlo Ancelotti to Tottenham as an
assistant coach on £50,000 a week to 30 June 2028. With the app, `tools/smoke --writes --only connect,staff,sign`: 64
passed, the staff signing through the command and through the Transfer dialog (Klopp to Manchester City, £12,345 a
week), each one slot taken from the pool and given back by the undo.
