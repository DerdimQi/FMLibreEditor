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
