# FM27: a club's debts

Where the game keeps the rows of a club's Debt and Loans screen (#118). heval99 found the list and the layout of a
record on the Windows Steam build 26340721. Reckbeg (a Brentford save of 17 August 2026) and pdalu (a new career of
20 July 2026, the game in Italian, with a manager at Genoa, Huddersfield, Mansfield, Brighton and Crystal Palace)
checked it on the Mac Steam build 26340721 against the game's own screens, and named the types. It was read again on
the Windows Game Pass build 0.9.2435.0, on a save of 12 January 2028 with the Turkish leagues. The path and the
layout are the same on all three.

The editor does not read or change debts yet.

## Finding them

A club points at its info record at `+0x100` (`[club] info`). The info record holds, at `+0x50`, the
`(begin, end, capacity)` of a list of pointers, each to one debt: a record of `0x1C` bytes. A club with no debts has
zeros there (Amed, Inter Miami). The rows of the game's screen are the records, in the list's order. No list read on
Game Pass had room to spare (capacity equal to the end), so adding a debt would mean growing the list.

## A debt

| Offset | Type | What it holds |
| --- | --- | --- |
| `+0x00` | `i32` pounds | the original debt, the screen's "Original Debt" |
| `+0x04` | `i32` pounds | the payment a month, interest included, the screen's "Payable (per month)" |
| `+0x08` | `i32` pounds | the interest in that payment |
| `+0x0C` | `i32` | 0 in every record of every save |
| `+0x10` | date | the day it ends: `u16` day of the year with the game's flags above bit 8, then `u16` year |
| `+0x14` | date | the day it started |
| `+0x18` | `u8` | the type (below) |
| `+0x19` | `u8` | 1 in every record of every save |
| `+0x1A` | `u16` | 0 in most; 1 in a few, and `0x8000` in one (see Not known yet) |

Both payments of a PIK loan (type 13) mean something else: see below.

## The types

Named from the screens of clubs with a manager; the English is the game's own string. The counts are those of
Reckbeg's save, pdalu's and the Game Pass one.

| `+0x18` | The game's name | Records | Seen at |
| --- | --- | --- | --- |
| 1 | Bank Loan | 105, 125, 11 | Brentford, Crystal Palace, Galatasaray |
| 2 | Club Chairperson Loan (the string is "Club [job] Loan") | 29, 22, 2 | Crystal Palace |
| 5 | State Loan | 6, 8, 0 | Genoa |
| 6 | Supporters' Trust Loan | 3, 2, 0 | Brentford |
| 7 | Gift Loan | 4, 4, 0 | Mansfield |
| 8 | Gift Loan (Repayable on departure of chairperson) | 50, 57, 1 | Brentford, Genoa, Benevento |
| 9 | Gift Loan (Non-Repayable) | 2, 6, 0 | Brighton |
| 10 | Loan (Repayable on promotion to top division) | 2, 2, 0 | Huddersfield |
| 11 | Loan (Repayable when established in top division) | 2, 2, 0 | Huddersfield |
| 12 | Club Director Loan | 11, 7, 0 | Mansfield |
| 13 | not seen on a screen; "PIK Loan (Total amount of loan repayable on maturity)" fits | 0, 0, 4 | Galatasaray, Beşiktaş, Fenerbahçe, Trabzonspor |
| 15 | Misc. Debt | 138, 142, 13 | Crystal Palace, Benevento |

Reckbeg's save holds 352 records at 184 of the 249 clubs with finances, pdalu's 377 at 220 clubs, the Game Pass one
31 at 24 clubs. Women's clubs have lists too: the type 9 records of Crystal Palace, Charlton and Barcelona, and
Manchester City's type 8 on Game Pass, belong to their women's clubs.

## What the screen shows

Brentford's three rows, as stored and as shown:

| `+0x18` | `+0x00` | `+0x04` | `+0x08` | Started | Ends | The screen: original, a month |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | 61,300,000 | 0 | 0 | 1.7.2025 | 26.6.2045 | £61.3M, £0, dates N/A |
| 6 | 700,000 | 5,932 | 0 | 1.7.2023 | 30.6.2033 | £700K, £5.93K |
| 1 | 70,000,000 | 1,435,937 | 229,041 | 1.7.2025 | 30.6.2030 | £70M, £1.43M |

- **Remaining (Interest)**, for types 1, 2 and 15: the payments left, times the payment less its interest, and in
  brackets the payments left times the interest. Brentford's Bank Loan with 47 months to June 2030:
  47 × (1,435,937 − 229,041) = 56,724,112 and 47 × 229,041 = 10,764,927; the screen shows £56.72M (£10.76M).
- **Net Debt** adds up to the pound at Brentford: the remaining amounts and interest of the three (129,281,395), plus
  the transfer debt (107,238,186), less the balance (19,070,871), is the screen's 217,448,710. The transfer debt is
  not in this list.
- Types 10 and 11 show the whole original debt as remaining, although they have a payment a month. Type 9 shows £0
  remaining, and Brighton's Net Debt leaves it out. Types 7 and 12 at Mansfield showed 23 and 35 payments' worth, one
  fewer than the months left to their ends.
- Types 8 and 9 show no dates (N/A); their records hold them all the same.
- The screen exists only for a club with a human manager, which is why the types were named there.

## How the amounts fit together

The part of the payment that is not interest, `+0x04` less `+0x08`, is the original debt divided by a whole number
of payments, rounded down: in every record quoted in #118 that has a payment, and in all 26 on Game Pass.
Galatasaray's Bank Loan of 50,693,224 over 59 payments is 859,207, and with 111,713 of interest the 970,920 it
holds. That number is the months from the start's month to the end's, give or take one: 58 for a loan from 1.7.2025
to 30.6.2030, 59 from 1.6.2026 to 1.6.2031, 120 from 29.6.2026 to 26.6.2036, 36 for Mansfield's Gift Loan from
1.7.2025 to 30.6.2028. Which it is for a given pair of dates is not worked out.

The interest is the same every month, a share of the original debt: 2.64% a year on each of the four Turkish
clubs' five-year Bank Loans of June 2026. Many debts have none.

## PIK loans

The four type 13 records, all at Turkish clubs, on Game Pass:

| Club | `+0x00` | `+0x04` | `+0x08` | Started | Ends |
| --- | --- | --- | --- | --- | --- |
| Galatasaray | 160,629,008 | 204,056,678 | 79,645,153 | 1.6.2026 | 1.6.2036 |
| Beşiktaş | 165,350,048 | 210,054,159 | 81,986,002 | 1.6.2026 | 1.6.2036 |
| Fenerbahçe | 252,300,256 | 320,512,220 | 125,098,869 | 1.6.2026 | 1.6.2036 |
| Trabzonspor | 172,599,136 | 224,318,898 | 94,210,353 | 1.6.2025 | 1.6.2036 |

Galatasaray's is the record heval99 read on Steam, with the same amounts in another save, so they come from the
game's database and do not change as the days go by.

- `+0x08` is the interest of the whole loan, not a month's: 5% a year of the original debt, a month's share rounded
  down, times the months of the loan less one. For Galatasaray 160,629,008 × 0.05 / 12 is 669,287, and 119 of them
  are 79,645,153; Trabzonspor's 719,163 times 131 is 94,210,353. All four fit to the pound.
- `+0x04` is 1.27036 times the original debt on the three ten-year loans and 1.29965 on Trabzonspor's of eleven
  years: likely what is to be repaid when the loan ends, as the game's name for the type says. How it is worked out
  is not known, and it is not the debt plus `+0x08`.
- `+0x1A` is 1 on all four.

## Not known yet

- Types 3, 4 and 14: no record in any of the saves. The game's strings have more debt names that no type was
  matched to: "Loan", "Players Union Loan", "Mortgage Loan", and two more loans repaid on promotion ("… with an
  initial amount of … repaid immediately", "… repaid immediately on promotion to top division").
- Type 13 on a screen: its name, and what the screen makes of `+0x04` and `+0x08`. It needs a career at one of the
  four Turkish clubs.
- `+0x1A`: 1 on the four PIK loans, on Tottenham's £250M Bank Loan and Watford's Gift Loan in pdalu's save, and on
  10 of Reckbeg's 352; `0x8000` on the Gift Loan of Manchester City's women's club on Game Pass.
- How many payments a debt has, from its dates (above), and what the game does to a record as it is paid off: none
  of the saves was read again later in its season.
- Changing them. heval99 raised the original debt, the payment and the interest of a record by one, read them back
  and put the record back; nothing was looked at in the game. Whether the game takes a changed amount, a debt
  taken out of the list or one added is untested.
