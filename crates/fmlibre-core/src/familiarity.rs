//! How well a team's players know the tactic it plays, and Max tactics, which has them know it at its best.
//!
//! The Tactical Effectiveness screen shows each player's eight tactical areas (see `tactical_areas.rs`), and the game
//! keeps how well he knows each in two places ([`FamiliarityLayout`]):
//!
//! - **His record**, which the player points at: six lists of 4-byte entries, one for each area that takes an option,
//!   each an option's code (six bits from bit 14) and how well he knows it × 100 (bits 0–13); then a list of 16-byte
//!   entries for the shapes, one for each formation he knows, its value × 100 in a `u16`. For the option a tactic plays
//!   he knows the best of his entries less 10 for each step between their codes, and 10 at least.
//! - **His history of training**, which the training manager keeps for each human manager's players: 12-byte entries,
//!   each a day, an area and an option (or the code of his place in the formation, for a shape), and three factors.
//!   Each adds to its area a weight for its age (12 in its first week, down to 0 after 251 days), times how close its
//!   option is to the tactic's (1 less 0.1 for each step), times the factors; an area holds at most 100.
//!
//! The screen's circles look like the mean of the two: with a new line of engagement, the record at 100 for its option
//! and the history at 0, they read half full. The editor shows that mean.
//!
//! Max tactics writes both for the tactic the human manager plays with the team. In the record, the entry for each
//! area's option goes to 100, and is added where he has none: a player new to the club has only his old club's
//! options. His shapes go to 100. His history is written as training done today on the tactic's options and his
//! shapes, at the factors' most, at least 18 entries for each area, as a player long at the club has: they keep each
//! area full for six weeks, where 9 would fall below it after one. A list too short for that, or full, is grown into
//! memory of the editor's own (see `own_memory.rs`), and the old buffer stays as it was, for the undo. A player the
//! training manager keeps no history for, one who does not train, as when injured, has his record written and his
//! history left as it is: the game makes one when he trains.
//!
//! Read and written on the Mac (Steam 27.0.1, the Benevento save, November 2026): after Max tactics the eight circles of
//! every senior player were full, a save made then loaded and played on, and the lists grown into the editor's memory
//! held through the game moving them into its own buffers as it added to them.

use std::collections::HashMap;

use fmlibre_mem::{Process, is_user_pointer};
use serde::Serialize;

use crate::clubs::ClubSummary;
use crate::own_memory::Growth;
use crate::players::{PlayerIndex, PlayerSummary};
use crate::profile::FamiliarityLayout;
use crate::session::Session;
use crate::tactical_areas::area_options;
use crate::transfer::{MoveError, Patch, Patches};

/// The areas that take an option; the two shapes come after them.
const OPTION_AREAS: usize = 6;
/// How well a player knows an option or a shape at best, × 100.
const BEST: u16 = 10_000;
/// The bits of a record entry's first two bytes that hold how well he knows the option.
const VALUE_BITS: u16 = 0x3FFF;
/// The options the game gives a tactic's areas, from 1 to 20 (see `area_options`).
const OPTIONS: std::ops::RangeInclusive<i32> = 1..=20;
/// The bytes of an entry of a record's lists, of its list of shapes, and of the history.
const RECORD_ENTRY: u64 = 4;
const SHAPE_ENTRY: u64 = 16;
const HISTORY_ENTRY: u64 = 12;
/// Where a shape's entry keeps how well he knows it, × 100: after the 13 bytes of the formation's places it is for.
const SHAPE_VALUE: usize = 0xE;
/// The tag of a history entry for an area that takes an option (its bytes +2); a shape's has the code of the player's
/// place in the formation there.
const AREA_TAG: u16 = 0x0C8C;
/// The entries of history Max tactics writes for each area, at least.
const ENTRIES_PER_AREA: usize = 18;
/// The longest lists the editor reads: no record list on the Benevento save held more than 8, no history more than 170.
const MOST_RECORD_ENTRIES: u64 = 64;
const MOST_SHAPES: u64 = 64;
const MOST_HISTORY: u64 = 4_000;
/// More human managers than a save holds, and more players than one keeps a history for.
const MOST_MANAGERS: u64 = 64;
const MOST_NODES: usize = 10_000;

/// How much a history entry adds to its area for its age in days, the first age at most each one
/// (game_plugin+0x54014d4, and +0x54014ec when the entry's byte +7 is set; macOS 26340721); nothing after the last.
const AGE: [&[(i32, f32)]; 2] = [
    &[(6, 12.0), (13, 9.0), (20, 7.0), (41, 6.0), (83, 4.0), (251, 2.0)],
    &[(6, 12.0), (13, 9.0), (20, 7.0), (41, 5.0), (83, 4.0), (193, 3.0), (251, 2.0)],
];
/// The factor for the entry's byte +9, the session's: the first threshold at least it (game_plugin+0x5401608); 1 above.
const SESSION: [(i32, f32); 7] = [(8, 0.75), (10, 0.8), (12, 0.85), (14, 0.9), (16, 0.95), (18, 1.0), (20, 1.0)];
/// The factor for the entry's byte +10, the player's (game_plugin+0x54016d8); 1 above them.
const PLAYER: [(i32, f32); 10] =
    [(8, 0.7), (10, 0.75), (12, 0.8), (13, 0.85), (14, 0.87), (15, 0.9), (16, 0.95), (17, 0.97), (18, 1.0), (20, 1.0)];
/// The factor for the entry's byte +11: the last threshold at most it (game_plugin+0x5401508).
const WEEKS: [(i32, f32); 9] =
    [(0, 0.6), (4, 0.65), (8, 0.7), (26, 0.75), (52, 0.8), (78, 0.85), (104, 0.9), (130, 0.95), (156, 1.0)];
/// The factors' bytes at their most, as Max tactics writes them.
const MOST_FACTORS: [u8; 3] = [20, 20, 156];

/// How well a player knows the tactic his team plays, as the editor shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Familiarity {
    /// The mean over his areas of the record's value and the history's, 0..100.
    pub overall: u8,
    /// Whether the training manager keeps a history of training for him: none for one who does not train.
    pub trains: bool,
}

/// Max tactics worked out for one player: the writes that set his record and his history, and the lists to grow.
#[derive(Debug, Clone)]
pub struct TacticsPlan {
    pub player: u32,
    /// How well he knows the tactic before, and after.
    pub before: Familiarity,
    pub after: Familiarity,
    patches: Vec<Patch>,
    grow: Vec<Growth>,
}

impl TacticsPlan {
    /// Whether it writes anything.
    pub fn writes(&self) -> bool {
        !self.patches.is_empty() || !self.grow.is_empty()
    }
}

/// Max tactics written for one player: what undoing it takes.
#[derive(Debug, Clone)]
pub struct TacticsSet {
    pub player: u32,
    pub before: Familiarity,
    pub after: Familiarity,
    patches: Vec<Patch>,
}

/// A player's history of training as the training manager keeps it, for the probe: the person's id, where his node
/// keeps the list `(begin, end, capacity)`, and those three words.
#[derive(Debug, Clone, Copy)]
pub struct TrainingHistory {
    pub person: u32,
    pub header: u64,
    pub list: [u64; 3],
}

/// One of a player's lists in the game's `(begin, end, capacity)`: where it keeps those, what they are, and its bytes.
#[derive(Debug, Clone)]
struct List {
    header: u64,
    was: [u64; 3],
    bytes: Vec<u8>,
}

impl List {
    fn begin(&self) -> u64 {
        self.was[0]
    }

    /// Whether its buffer has room for `bytes` more.
    fn room_for(&self, bytes: u64) -> bool {
        self.was[2] - self.was[1] >= bytes
    }
}

/// A player's record: the six lists of options and the list of shapes.
#[derive(Debug, Clone)]
struct Record {
    areas: Vec<List>,
    shapes: Option<List>,
}

/// The tactic a team plays, as the familiarity of its players is measured against: its options, the day of the year
/// from 0, and the history of training of each player the human manager's club keeps one for, by person id.
struct TeamTactic {
    options: [i8; OPTION_AREAS],
    today: u16,
    histories: HashMap<u32, List>,
}

impl Session {
    /// How well each player of the team at `team` in the list of `club`'s teams knows the tactic it plays, by UID:
    /// `None` where the layout does not place familiarity, or no human manager picks the team's tactic. A player without
    /// a record of familiarity is not among them.
    pub fn team_familiarity(
        &self,
        club: &ClubSummary,
        team: usize,
        players: &PlayerIndex,
    ) -> Result<Option<HashMap<u32, Familiarity>>, MoveError> {
        let (Some(f), Some(tactic)) = (&self.layout.familiarity, self.team_tactic(club, team)?) else {
            return Ok(None);
        };
        let mut known = HashMap::new();
        for member in
            self.club_teams(club, players)?.into_iter().find(|t| t.index == team).into_iter().flat_map(|t| t.players)
        {
            let Some(player) = players.get(member.uid).filter(|_| member.plays_here) else {
                continue;
            };
            let Some(record) = self.familiarity_record(f, player)? else {
                continue;
            };
            let history = tactic.histories.get(&self.training_person(f, player)?);
            known.insert(player.uid, familiarity(&tactic, &record, history.map(|h| h.bytes.as_slice())));
        }
        Ok(Some(known))
    }

    /// Works out Max tactics for each player who plays for the team at `team` in the list of `club`'s teams (see the
    /// module's notes); `None` where the layout does not place familiarity, or no human manager picks the team's tactic.
    /// A player without a record of familiarity is left out. Nothing is written.
    pub fn plan_max_tactics(
        &self,
        club: &ClubSummary,
        team: usize,
        players: &PlayerIndex,
    ) -> Result<Option<Vec<TacticsPlan>>, MoveError> {
        let (Some(f), Some(tactic)) = (&self.layout.familiarity, self.team_tactic(club, team)?) else {
            return Ok(None);
        };
        let members = self.club_teams(club, players)?.into_iter().find(|t| t.index == team).map(|t| t.players);
        let mut plans = Vec::new();
        for member in members.into_iter().flatten().filter(|m| m.plays_here) {
            let Some(player) = players.get(member.uid) else {
                continue;
            };
            let Some(record) = self.familiarity_record(f, player)? else {
                continue;
            };
            let history = tactic.histories.get(&self.training_person(f, player)?);
            plans.push(self.plan_player_tactics(&tactic, player.uid, record, history));
        }
        Ok(Some(plans))
    }

    /// Writes Max tactics planned for one player, only over what the plan found: the lists to grow get their buffers
    /// first, then every write is made after checking them all.
    pub fn apply_tactics(&self, plan: &TacticsPlan) -> Result<TacticsSet, MoveError> {
        if let Some(lock) = self.tactics_lock() {
            return Err(MoveError::Locked(lock));
        }
        let mut patches = plan.patches.clone();
        for growth in &plan.grow {
            patches.push(self.grown_list(growth)?);
        }
        self.apply_patches(&patches)?;
        let TacticsPlan { player, before, after, .. } = *plan;
        Ok(TacticsSet { player, before, after, patches })
    }

    /// Puts the record and the history back as they were, provided they still hold what Max tactics wrote: the game
    /// changes both as it moves on. A grown list is pointed back at its old buffer.
    pub fn undo_tactics(&self, done: &TacticsSet) -> Result<(), MoveError> {
        self.undo_patches(&done.patches)
    }

    /// The histories of training the training manager keeps for the players of `club`'s human manager, for the probe.
    /// `None` where the layout or the build does not place them, or it keeps none for the club.
    pub fn training_histories(&self, club: &ClubSummary) -> Result<Option<Vec<TrainingHistory>>, MoveError> {
        let (Some(f), Some(rva)) = (&self.layout.familiarity, self.profile.as_ref().and_then(|p| p.training_manager))
        else {
            return Ok(None);
        };
        let process = &self.process;
        let Some(keeper) = training_keeper(process, f, process.read_u64(self.plugin.base + rva)?, club.address)? else {
            return Ok(None);
        };
        let histories = histories(process, f, keeper)?.ok_or(MoveError::NotListed)?;
        Ok(Some(
            histories
                .into_iter()
                .map(|(person, list)| TrainingHistory { person, header: list.header, list: list.was })
                .collect(),
        ))
    }

    /// The tactic the team at `team` plays and its players' histories; `None` where the layout or the build does not
    /// place them, or no human manager picks its tactic.
    fn team_tactic(&self, club: &ClubSummary, team: usize) -> Result<Option<TeamTactic>, MoveError> {
        let (Some(f), Some(instructions)) =
            (&self.layout.familiarity, self.layout.tactics.as_ref().map(|t| t.instructions))
        else {
            return Ok(None);
        };
        let Some(rva) = self.profile.as_ref().and_then(|p| p.training_manager) else {
            return Ok(None);
        };
        let Some(block) = self.tactic_in_use(self.team_object(club, team)?)? else {
            return Ok(None);
        };
        let Some(date) = self.game_date() else {
            return Ok(None);
        };
        let process = &self.process;
        let options =
            area_options([process.read_u64(block + instructions)?, process.read_u64(block + instructions + 8)?]);
        let Some(keeper) = training_keeper(process, f, process.read_u64(self.plugin.base + rva)?, club.address)? else {
            return Ok(None);
        };
        let histories = histories(process, f, keeper)?.ok_or(MoveError::NotListed)?;
        Ok(Some(TeamTactic { options, today: date.day_of_year() - 1, histories }))
    }

    /// The id the training manager keys `player` by.
    fn training_person(&self, f: &FamiliarityLayout, player: &PlayerSummary) -> Result<u32, MoveError> {
        let p = &self.layout.player;
        if self.process.read_u32(player.address + p.at(p.uid, player.shift))? != player.uid {
            return Err(MoveError::Moved { uid: player.uid });
        }
        Ok(self.process.read_u32(player.address + p.at(f.player_person, player.shift))?)
    }

    /// The record of familiarity of `player`; `None` for one without.
    fn familiarity_record(&self, f: &FamiliarityLayout, player: &PlayerSummary) -> Result<Option<Record>, MoveError> {
        let p = &self.layout.player;
        if self.process.read_u32(player.address + p.at(p.uid, player.shift))? != player.uid {
            return Err(MoveError::Moved { uid: player.uid });
        }
        let at = self.process.read_u64(player.address + p.at(f.record, player.shift))?;
        if !is_user_pointer(at) {
            return Ok(None);
        }
        read_record(&self.process, f, at)?.map(Some).ok_or(MoveError::NotListed)
    }

    /// Max tactics for one player: his record's option entries and shapes at their best, an entry added where an area
    /// has none for the tactic's option, and his history (where he has one) rewritten as today's training.
    fn plan_player_tactics(
        &self,
        tactic: &TeamTactic,
        player: u32,
        record: Record,
        history: Option<&List>,
    ) -> TacticsPlan {
        let before = familiarity(tactic, &record, history.map(|h| h.bytes.as_slice()));
        let (mut patches, mut grow) = (Patches::default(), Vec::new());
        let mut new_record = record.clone();
        for (area, list) in new_record.areas.iter_mut().enumerate() {
            let option = i32::from(tactic.options[area]);
            let old = list.bytes.clone();
            match list.bytes.as_chunks::<{ RECORD_ENTRY as usize }>().0.iter().position(|e| entry_code(e) == option) {
                Some(i) => set_value(&mut list.bytes[i * RECORD_ENTRY as usize..], BEST),
                None => {
                    let mut entry = ((option as u32 & 0x3F) << 14 | u32::from(BEST)).to_le_bytes();
                    entry[3] = list.bytes.get(3).copied().unwrap_or(0);
                    if list.room_for(RECORD_ENTRY) {
                        // Where the buffer has room, after the last entry: then the list's end moves past it.
                        let end = list.was[1];
                        patches.push(end, self.read_or_zero(end, RECORD_ENTRY), entry);
                        patches.push(list.header + 8, end.to_le_bytes(), (end + RECORD_ENTRY).to_le_bytes());
                        list.bytes.extend_from_slice(&entry);
                        continue;
                    }
                    list.bytes.extend_from_slice(&entry);
                    if let Some(growth) = self.growth(list.header, list.was, list.bytes.clone(), RECORD_ENTRY) {
                        grow.push(growth);
                    } else {
                        // Where the editor cannot take memory, the area keeps the entries it has.
                        list.bytes.truncate(old.len());
                    }
                    continue;
                }
            }
            patches.push(list.begin(), old, list.bytes.clone());
        }
        if let Some(shapes) = &mut new_record.shapes {
            let old = shapes.bytes.clone();
            for entry in shapes.bytes.as_chunks_mut::<{ SHAPE_ENTRY as usize }>().0 {
                entry[SHAPE_VALUE..SHAPE_VALUE + 2].copy_from_slice(&BEST.to_le_bytes());
            }
            patches.push(shapes.begin(), old, shapes.bytes.clone());
        }
        let new_history = history.map(|list| {
            let entries = today_history(tactic, &list.bytes);
            let length = entries.len() as u64;
            if length * HISTORY_ENTRY <= list.was[2] - list.was[0] {
                // Within its buffer: the entries over the old ones and those after, and the end past the last.
                let (begin, end) = (list.was[0], list.was[0] + length * HISTORY_ENTRY);
                let mut old = list.bytes.clone();
                old.extend(self.read_or_zero(list.was[1], end.saturating_sub(list.was[1])));
                patches.push(begin, old, entries.clone());
                patches.push(list.header + 8, list.was[1].to_le_bytes(), end.to_le_bytes());
                entries
            } else if let Some(growth) = self.growth(list.header, list.was, entries.clone(), HISTORY_ENTRY) {
                grow.push(growth);
                entries
            } else {
                // Where the editor cannot take memory, the entries he has, rewritten.
                let kept: Vec<u8> = entries.into_iter().take(list.bytes.len()).collect();
                patches.push(list.begin(), list.bytes.clone(), kept.clone());
                kept
            }
        });
        let after = familiarity(tactic, &new_record, new_history.as_deref().or(history.map(|h| h.bytes.as_slice())));
        TacticsPlan { player, before, after, patches: patches.0, grow }
    }

    /// The `len` bytes at `at`, or zeros where they cannot be read.
    fn read_or_zero(&self, at: u64, len: u64) -> Vec<u8> {
        self.process.read_bytes(at, len as usize).unwrap_or_else(|_| vec![0; len as usize])
    }
}

/// The training manager's object for the human manager of the club at `club`, from the training manager at
/// `manager`; `None` where it keeps none for the club.
fn training_keeper(
    process: &Process,
    f: &FamiliarityLayout,
    manager: u64,
    club: u64,
) -> Result<Option<u64>, MoveError> {
    if !is_user_pointer(manager) {
        return Ok(None);
    }
    let (first, last) = (process.read_u64(manager + f.managers)?, process.read_u64(manager + f.managers + 8)?);
    if !is_user_pointer(first) || last < first || last - first > 8 * MOST_MANAGERS {
        return Ok(None);
    }
    for at in (first..last).step_by(8) {
        let keeper = process.read_u64(at)?;
        if is_user_pointer(keeper) && process.read_u64(keeper + f.club)? == club {
            return Ok(Some(keeper));
        }
    }
    Ok(None)
}

/// The history of training the training manager's object at `keeper` holds for each player, by person id: its map's
/// nodes walked from the root, as the C++ library lays them out (see `tree.rs`). `None` where a node or a list does
/// not check out.
fn histories(process: &Process, f: &FamiliarityLayout, keeper: u64) -> Result<Option<HashMap<u32, List>>, MoveError> {
    let mut found = HashMap::new();
    let (walk, root) = f.tree.root(process, keeper + f.players)?;
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if !walk.is_node(process, node)? {
            continue;
        }
        if found.len() >= MOST_NODES {
            return Ok(None);
        }
        let id = process.read_u32(node + f.person)?;
        let Some(list) = read_list(process, node + f.history, HISTORY_ENTRY, MOST_HISTORY)? else {
            return Ok(None);
        };
        if !list.bytes.as_chunks::<{ HISTORY_ENTRY as usize }>().0.iter().all(|e| history_entry_holds(e)) {
            return Ok(None);
        }
        found.insert(id, list);
        stack.extend(walk.children(process, node)?);
    }
    Ok(Some(found))
}

/// The list in `(begin, end, capacity)` at `header`, of entries of `size` bytes; `None` where the words there are not
/// those of a list of at most `most` of them, a buffer and none past its capacity, or of an empty list without a buffer.
fn read_list(process: &Process, header: u64, size: u64, most: u64) -> Result<Option<List>, MoveError> {
    let words = process.read_bytes(header, 24)?;
    let word = |i: usize| u64::from_le_bytes(words[i * 8..i * 8 + 8].try_into().expect("8 bytes"));
    let was = [word(0), word(1), word(2)];
    // An empty list the game has not given a buffer yet: some players' records have six of them.
    if was == [0; 3] {
        return Ok(Some(List { header, was, bytes: Vec::new() }));
    }
    let [begin, end, capacity] = was;
    let holds = is_user_pointer(begin)
        && begin <= end
        && end <= capacity
        && (end - begin).is_multiple_of(size)
        && (capacity - begin).is_multiple_of(size)
        && end - begin <= most * size;
    if !holds {
        return Ok(None);
    }
    Ok(Some(List { header, was, bytes: process.read_bytes(begin, (end - begin) as usize)? }))
}

/// The record of familiarity at `at`: its six lists of options, each naming its area, with codes from 1 to 20 and
/// values of at most 100; and its list of shapes, if it has one, with values of at most 100. `None` where it does not
/// check out.
fn read_record(process: &Process, f: &FamiliarityLayout, at: u64) -> Result<Option<Record>, MoveError> {
    let mut areas = Vec::with_capacity(OPTION_AREAS);
    for area in 0..OPTION_AREAS as u64 {
        let header = at + area * f.area_step;
        if u64::from(process.read_bytes(header + f.area_index, 1)?[0]) != area {
            return Ok(None);
        }
        let Some(list) = read_list(process, header, RECORD_ENTRY, MOST_RECORD_ENTRIES)? else {
            return Ok(None);
        };
        let fits = |e: &[u8]| OPTIONS.contains(&entry_code(e)) && entry_value(e) <= BEST;
        if !list.bytes.as_chunks::<{ RECORD_ENTRY as usize }>().0.iter().all(|e| fits(e)) {
            return Ok(None);
        }
        areas.push(list);
    }
    let words = process.read_bytes(at + f.shapes, 16)?;
    let shapes = if words.iter().all(|&b| b == 0) {
        None
    } else {
        let Some(list) = read_list(process, at + f.shapes, SHAPE_ENTRY, MOST_SHAPES)? else {
            return Ok(None);
        };
        if !list.bytes.as_chunks::<{ SHAPE_ENTRY as usize }>().0.iter().all(|e| shape_value(e) <= BEST) {
            return Ok(None);
        }
        Some(list)
    };
    Ok(Some(Record { areas, shapes }))
}

/// Whether the record of familiarity at `at` checks out (see [`read_record`]); for the checks.
pub(crate) fn record_holds(process: &Process, f: &FamiliarityLayout, at: u64) -> bool {
    matches!(read_record(process, f, at), Ok(Some(_)))
}

/// How many players the training manager keeps a history for, and whether every one checks out: for the checks.
/// `None` where the build's profile places no training manager. A manager without a club has none listed.
pub(crate) fn histories_hold(session: &Session, f: &FamiliarityLayout) -> Option<(u64, bool)> {
    let process = &session.process;
    let rva = session.profile.as_ref().and_then(|p| p.training_manager)?;
    let Some(manager) = process.read_u64(session.plugin.base + rva).ok().filter(|&m| is_user_pointer(m)) else {
        return Some((0, false));
    };
    let (first, last) =
        (process.read_u64(manager + f.managers).ok()?, process.read_u64(manager + f.managers + 8).ok()?);
    if first == last {
        return Some((0, true));
    }
    if !is_user_pointer(first) || last < first || last - first > 8 * MOST_MANAGERS {
        return Some((0, false));
    }
    let (mut count, mut holds) = (0, true);
    for at in (first..last).step_by(8) {
        let Some(keeper) = process.read_u64(at).ok().filter(|&k| is_user_pointer(k)) else {
            holds = false;
            continue;
        };
        match histories(process, f, keeper) {
            Ok(Some(found)) => count += found.len() as u64,
            _ => holds = false,
        }
    }
    Some((count, holds))
}

/// Whether a history entry looks like the game's: an area from 0 to 7, the tag of an option's area for the first six,
/// a day of the year, and its kinds.
fn history_entry_holds(e: &[u8]) -> bool {
    let (day, tag, area, shape) = (u16::from_le_bytes([e[0], e[1]]), u16::from_le_bytes([e[2], e[3]]), e[4], e[8]);
    day < 366
        && match (area, shape) {
            (0..=5, 0) => tag == AREA_TAG,
            (6 | 7, 1) => true,
            _ => false,
        }
}

/// The option code of a record entry: six bits from bit 14, signed, as the game reads it (`sbfx #14, #6`).
fn entry_code(e: &[u8]) -> i32 {
    let packed = u32::from(e[0]) | u32::from(e[1]) << 8 | u32::from(e[2]) << 16;
    ((packed << 12) as i32) >> 26
}

/// How well a record entry says he knows its option, × 100.
fn entry_value(e: &[u8]) -> u16 {
    u16::from_le_bytes([e[0], e[1]]) & VALUE_BITS
}

/// How well a shape's entry says he knows it, × 100.
fn shape_value(e: &[u8]) -> u16 {
    u16::from_le_bytes([e[SHAPE_VALUE], e[SHAPE_VALUE + 1]])
}

/// Sets how well a record entry says he knows its option, keeping its code's bits.
fn set_value(e: &mut [u8], value: u16) {
    let packed = (u16::from_le_bytes([e[0], e[1]]) & !VALUE_BITS) | value;
    e[..2].copy_from_slice(&packed.to_le_bytes());
}

/// How well a player with `record` and `history` knows the tactic (see the module's notes).
fn familiarity(tactic: &TeamTactic, record: &Record, history: Option<&[u8]>) -> Familiarity {
    let shapes = history.map_or([None; 2], shapes_of);
    let trained = history.map(|h| history_areas(h, &tactic.options, shapes, tactic.today));
    let known = record_areas(record, &tactic.options);
    let mut sum = 0u32;
    let mut count = 0u32;
    for area in 0..8 {
        let Some(from_record) = known[area] else {
            continue;
        };
        let from_history = match trained {
            Some(trained) => match trained[area] {
                Some(value) => value,
                None => continue,
            },
            None => 0,
        };
        sum += (u32::from(from_record) + u32::from(from_history)) / 2;
        count += 1;
    }
    let overall = (sum + count / 2).checked_div(count).unwrap_or(0) as u8;
    Familiarity { overall, trains: history.is_some() }
}

/// What the record says, area by area, 0..100: for each option the best of the entries less 10 for each step between
/// codes, and 10 at least; for the shapes the best he knows (the screen weighs the formation in use, which the editor
/// does not read), none where he has none.
fn record_areas(record: &Record, options: &[i8; OPTION_AREAS]) -> [Option<u8>; 8] {
    let mut areas = [None; 8];
    for (area, list) in record.areas.iter().enumerate() {
        let option = i32::from(options[area]);
        let best = list
            .bytes
            .as_chunks::<{ RECORD_ENTRY as usize }>()
            .0
            .iter()
            .map(|e| i32::from(entry_value(e)) - 1_000 * (entry_code(e) - option).abs())
            .max();
        areas[area] = Some((best.map_or(0, |b| b.max(1_000)) / 100) as u8);
    }
    if let Some(shapes) = &record.shapes {
        let best =
            shapes.bytes.as_chunks::<{ SHAPE_ENTRY as usize }>().0.iter().map(|e| shape_value(e)).max().unwrap_or(0);
        areas[6] = Some((best / 100) as u8);
        areas[7] = areas[6];
    }
    areas
}

/// The codes of a player's shapes, in and out of possession: those of his latest entries for each, which follow his
/// place in the team's formation.
fn shapes_of(history: &[u8]) -> [Option<u16>; 2] {
    let entries = history.as_chunks::<{ HISTORY_ENTRY as usize }>().0;
    [6u8, 7].map(|area| {
        entries
            .iter()
            .rev()
            .filter(|e| e[8] == 1 && e[4] == area)
            .max_by_key(|e| u16::from_le_bytes([e[0], e[1]]))
            .map(|e| u16::from_le_bytes([e[2], e[3]]))
    })
}

/// What a history adds up to, area by area, 0..100, as the game works it out for the Tactical Effectiveness screen
/// (game_plugin+0x486d408, macOS 26340721): `None` for an area holding a shape other than the player's, whose closeness
/// the game works out from the formations.
fn history_areas(
    history: &[u8],
    options: &[i8; OPTION_AREAS],
    shapes: [Option<u16>; 2],
    today: u16,
) -> [Option<u8>; 8] {
    let mut sums = [Some(0.0f32); 8];
    for e in history.as_chunks::<{ HISTORY_ENTRY as usize }>().0 {
        let area = usize::from(e[4]).min(7);
        match entry_weight(e, options, shapes, today) {
            Some(weight) => sums[area] = sums[area].map(|s| s + weight),
            None => sums[area] = None,
        }
    }
    sums.map(|s| s.map(|s| s.round().clamp(0.0, 100.0) as u8))
}

/// How much one history entry adds to its area (see [`history_areas`]).
fn entry_weight(e: &[u8], options: &[i8; OPTION_AREAS], shapes: [Option<u16>; 2], today: u16) -> Option<f32> {
    let area = e[4] as usize;
    let closeness = match e[8] {
        0 if area < OPTION_AREAS => (1.0 - 0.1 * f32::from((e[6] as i8).abs_diff(options[area]))).max(0.0),
        1 if (6..8).contains(&area) => {
            if shapes[area - 6] != Some(u16::from_le_bytes([e[2], e[3]])) {
                return None;
            }
            1.0
        }
        _ => 0.0,
    };
    if closeness <= 0.0 {
        return Some(0.0);
    }
    let age = (i32::from(today) - i32::from(u16::from_le_bytes([e[0], e[1]]))).rem_euclid(365);
    let first_at_least =
        |table: &[(i32, f32)], v: i32, above: f32| table.iter().find(|t| t.0 >= v).map_or(above, |t| t.1);
    let aged = first_at_least(AGE[usize::from(e[7] != 0)], age, 0.0);
    let kind = match e[5] {
        0 => 1.0,
        1 | 3 => 0.8,
        2 => 0.2,
        4 => 0.1,
        _ => 0.0,
    };
    let session = first_at_least(&SESSION, i32::from(e[9]), 1.0);
    let player = first_at_least(&PLAYER, i32::from(e[10] as i8), 1.0);
    let weeks = WEEKS.iter().rev().find(|t| t.0 <= i32::from(e[11])).map_or(0.75, |t| t.1);
    Some(closeness * aged * kind * session * player * weeks)
}

/// A player's history rewritten as training done today: on the tactic's options and his shapes, at the factors' most,
/// the areas taken in turn, as many entries as he had and at least [`ENTRIES_PER_AREA`] for each area.
fn today_history(tactic: &TeamTactic, history: &[u8]) -> Vec<u8> {
    let shapes = shapes_of(history);
    let areas: Vec<usize> = (0..8).filter(|&a| a < OPTION_AREAS || shapes[a - OPTION_AREAS].is_some()).collect();
    let count = (history.len() / HISTORY_ENTRY as usize).max(ENTRIES_PER_AREA * areas.len());
    let mut out = Vec::with_capacity(count * HISTORY_ENTRY as usize);
    for i in 0..count {
        let area = areas[i % areas.len()];
        let mut e = [0u8; HISTORY_ENTRY as usize];
        e[..2].copy_from_slice(&tactic.today.to_le_bytes());
        if area < OPTION_AREAS {
            e[2..4].copy_from_slice(&AREA_TAG.to_le_bytes());
            e[6] = tactic.options[area] as u8;
        } else {
            e[2..4].copy_from_slice(&shapes[area - OPTION_AREAS].expect("an area he has a shape for").to_le_bytes());
            e[6] = 0xFF;
            e[8] = 1;
        }
        e[4] = area as u8;
        e[9..12].copy_from_slice(&MOST_FACTORS);
        out.extend_from_slice(&e);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Benevento's tactic with a high press (Mac, November 2026), on day 259.
    fn tactic() -> TeamTactic {
        TeamTactic { options: [19, 17, 10, 4, 20, 10], today: 259, histories: HashMap::new() }
    }

    fn list(bytes: Vec<u8>) -> List {
        let end = 0x1000 + bytes.len() as u64;
        List { header: 0, was: [0x1000, end, end], bytes }
    }

    fn record(areas: [&[(u32, u16)]; 6], shapes: &[u16]) -> Record {
        let areas = areas
            .iter()
            .map(|entries| {
                list(entries.iter().flat_map(|&(code, value)| (code << 14 | u32::from(value)).to_le_bytes()).collect())
            })
            .collect();
        let shapes = (!shapes.is_empty()).then(|| {
            list(
                shapes
                    .iter()
                    .flat_map(|&v| {
                        let mut e = [0u8; 16];
                        e[14..].copy_from_slice(&v.to_le_bytes());
                        e
                    })
                    .collect(),
            )
        });
        Record { areas, shapes }
    }

    #[test]
    fn record_entries_read_as_the_game_packs_them() {
        // Ricci's area 0 on the Mac: option 1 at 96.64.
        let e = 0x65C0u32.to_le_bytes();
        assert_eq!((entry_code(&e), entry_value(&e)), (1, 9_664));
        let mut e = (19u32 << 14 | 2_000).to_le_bytes();
        set_value(&mut e, BEST);
        assert_eq!((entry_code(&e), entry_value(&e)), (19, BEST));
    }

    #[test]
    fn an_option_far_from_the_one_known_is_known_at_ten() {
        // A player new to the club, who knows his old club's options at 96.64.
        let old = record(
            [&[(1, 9_664)], &[(3, 9_664)], &[(1, 9_664)], &[(12, 9_664)], &[(1, 9_664)], &[(15, 9_664)]],
            &[9_664, 9_664],
        );
        let areas = record_areas(&old, &tactic().options);
        assert_eq!(areas, [Some(10), Some(10), Some(10), Some(16), Some(10), Some(46), Some(96), Some(96)]);
    }

    #[test]
    fn todays_history_fills_every_area() {
        let mut history = Vec::new();
        // Seven entries of his first days, two of them his shapes.
        for (area, tag, option, shape) in
            [(5, AREA_TAG, 10, 0), (7, 0x3AB7, 0xFF, 1), (1, AREA_TAG, 17, 0), (6, 0x18F7, 0xFF, 1)]
        {
            let mut e = [0u8; 12];
            e[..2].copy_from_slice(&243u16.to_le_bytes());
            e[2..4].copy_from_slice(&u16::to_le_bytes(tag));
            (e[4], e[6], e[8], e[9], e[10], e[11]) = (area, option, shape, 11, 12, 6);
            history.extend_from_slice(&e);
        }
        let t = tactic();
        let new = today_history(&t, &history);
        assert_eq!(new.len(), 8 * ENTRIES_PER_AREA * 12);
        let areas = history_areas(&new, &t.options, shapes_of(&new), t.today);
        assert_eq!(areas, [Some(100); 8]);
        // A week on, each entry adds 9: still 100, where 9 entries would give 81.
        assert_eq!(history_areas(&new, &t.options, shapes_of(&new), t.today + 7), [Some(100); 8]);
    }

    #[test]
    fn the_circle_is_the_mean_of_record_and_history() {
        let t = tactic();
        let known =
            record([&[(19, BEST)], &[(17, BEST)], &[(10, BEST)], &[(4, BEST)], &[(20, BEST)], &[(10, BEST)]], &[BEST]);
        // A record at 100 and no history weighed: half full, as the line of engagement read after a change of it.
        let none = Vec::new();
        assert_eq!(familiarity(&t, &known, Some(&none)), Familiarity { overall: 50, trains: true });
        assert_eq!(familiarity(&t, &known, None), Familiarity { overall: 50, trains: false });
    }
}
