# FM27 Game Pass 0.9.2435.0 (the full release)

Observed on 10 November 2026, half an hour after the update to the full release, with the Game Pass package
`SportsInteractive.FootballManager27_0.9.2435.0_x64__5w3tn6tb6stnm`. The save, of 3 January 2028 (10,812 players,
9,359 staff and 19,775 clubs), had been read in full on 0.9.2409.0 the same day, right after loading it, and was read
again right after loading it on this build.

## The binary

`game_plugin.dll` as mapped in memory:

| | 0.9.2435.0 | 0.9.2409.0 |
|---|---|---|
| Size of image | `0x17969000` | `0x175DA000` |
| Link timestamp | `0x6AE8CF77`, 6,611 s after Steam build 26385295 | `0x6AE563A1` |

The sections' names were dealt anew, as in every build: the statics the editor uses are in `.link` (read-write), and
the large read-write-execute section is `.xtls`.

## What moved

The statics the editor uses sit about 0x2CC000 before those of 0.9.2409.0, but no longer at quite the same distances
from each other, unlike on Steam (see the [notes on build 26385295](fm27-steam-26385295.md)):

| | 0.9.2435.0 | 0.9.2409.0 | |
|---|---|---|---|
| Players pair | `0x53B7DE0` | `0x5683DC0` | −0x2CBFE0 |
| Staff pair | `0x53B7E28` | `0x5683E08` | −0x2CBFE0 |
| Clubs pair | `0x53B7F98` | `0x5683F78` | −0x2CBFE0 |
| In-game date | `0x53597C8` | `0x56257C8` | −0x2CC000 |
| Retirement manager's static | `0x53A9070`, 0xED70 before the players pair | `0x5675060`, 0xED60 before it | −0x2CBFF0 |

With no profile, the code of the released app (0.5.0) found them all by itself: the arrays by scanning, with every
sampled element decoded; the date by searching, as the one of 28 values that read as dates that fitted the contracts
(3,684 of 3,684) and the current injuries (155 of 155). The retirement manager was not where other builds keep it from
the players pair, so neither guess held it; the search for pointers to an object of its class found it. All ten checks
passed.

## What did not move

The object layout. As on Steam, `fmlibre-probe` read the save in full before the update, and the same probe read it
again after:
- the 10,812 players' 108 fields matched, but for one release clause's amount, which the new build changed when it
  loaded the save;
- the 19,772 clubs' 37 fields matched, but for 4 stadiums the new build names differently;
- the lists matched line by line, but for one player whose record of other contracts points at no contract, before
  and after, and one member of staff whose contract's end read as 3144 before the update and as a date in range after;
- the 220 witnesses (players, staff, clubs) read the same, and no part of their objects moved.

After a load, no contract had room for another clause (12 of 9,960 did on 0.9.2409.0 after a load of the same save).

## The day before, some days on

On 11 November 2026 the same save had moved on to 11 January 2028. Of the 30 values in the plugin's writable data
that read as dates, two fitted the contracts and the current injuries:

| | Date | Contract dates after it | Injuries that fit it | From the players pair |
|---|---|---|---|---|
| `+0x53597C8`, the date's own variable | 11 January 2028 | 0 of 3,712 | 173 of 173 | 0x5E618 before it |
| `+0x53886F8`, the value for the day before | 10 January 2028 | 3 of 3,712 | 161 of 173 | 0x2F6E8 before it |

The field beside the arrays (`+0x53B8628`) held 1 January 1900, unset, so the code of the released app (0.5.0), which
went by that field alone when two dates fitted, used neither: without a profile it showed no ages, and refused
signings for want of a date. Right after the load on 10 November, `+0x53886F8` had held no date.

On 0.9.2409.0 both values sat about as far from the players pair: the date 0x5E5F8 before it, the day before
(`+0x56546F8`) 0x2F6C8 before it. The search now takes the one date read within 0x400 bytes of where the other builds
keep their date, and else the one that fits better than every other (see `pick_date` in
`crates/fmlibre-core/src/health.rs`). With `FMLIBRE_IGNORE_PROFILES=1`, `fmlibre-probe health` read the 11th at
`+0x53597C8`, "about as far from the players' array as in another build", where the probe of 0.5.0's code still
used neither date.
