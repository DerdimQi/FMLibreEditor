//! Moving a member of staff to another club, giving him another job at his club, and signing one who has no club.
//!
//! A club keeps its staff in three department lists of pointers (see [`ClubLayout`]): the medical team, the coaches
//! and the scouts; a fitness coach may be in the first two. Its director of football is in none of them: the club
//! points at him itself, in its place for one (`director_of_football`), which most clubs leave empty. A member of
//! staff's contract points at the team he works for and at the club's senior team.
//!
//! A move takes him out of every department list of his old club that holds him, and out of its director of
//! football's place when it holds him. Keeping his job, he joins the same departments of the new club, and its place
//! for a director of football when he leaves one; given another job, he joins where that job is (see [`STAFF_JOBS`]).
//! His contract points at the new club's senior team, dated from today, with the job. A new job at his own club moves
//! him between his club's departments, or into or out of its director of football's place, as the job needs. A club's
//! place for a director of football takes one only while it is empty: the editor does not put one out of his job.
//!
//! Signing a member of staff who has no club: like a free agent (see `signing.rs`), he gets a contract the editor makes
//! in a slot of the game's own pool of contracts, a copy of one of the club's own staff's contracts (see
//! [`Session::plan_staff_signing`]), and joins where his job is.
//!
//! A department list with no room for him in its block is grown into memory of the editor's own (see
//! `own_memory.rs`), where the editor can grow it (see `Session::growth`); elsewhere the move is refused. Only staff
//! whom neither the club nor its teams point at directly, other than in its place for a director of football, are
//! moved or given a new job: a team's manager, for one, is held by his team, and is left to the game.
//!
//! The game keeps the contracts of some staff, most doctors and the board among them, as `db::BASIC_CONTRACT`: 40
//! bytes, as far as the job, with no dates. Only those first bytes of theirs are written.
//!
//! [`ClubLayout`]: crate::ClubLayout

use fmlibre_mem::is_user_pointer;
use serde::Serialize;

use crate::clubs::ClubSummary;
use crate::date::FmDate;
use crate::edit::Kind;
use crate::own_memory::Growth;
use crate::profile::Layout;
use crate::session::Session;
use crate::signing::default_expiry;
use crate::staff::StaffSummary;
use crate::transfer::{LISTED, MoveError, MoveTerms, NO_SQUAD_NUMBER, Patch, Patches, PointerList, removal_patches};

/// A department of a club's staff.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Department {
    Medical,
    Coaching,
    Scouting,
}

impl Department {
    pub fn name(self) -> &'static str {
        match self {
            Department::Medical => "medical",
            Department::Coaching => "coaching",
            Department::Scouting => "scouting",
        }
    }

    /// Where the club keeps the list of this department.
    fn offset(self, layout: &Layout) -> u64 {
        match self {
            Department::Medical => layout.club.medical_staff,
            Department::Coaching => layout.club.coaching_staff,
            Department::Scouting => layout.club.scouting_staff,
        }
    }
}

const DEPARTMENTS: [Department; 3] = [Department::Medical, Department::Coaching, Department::Scouting];

/// Where a job puts a member of staff at his club.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Post {
    /// In the list of a department.
    Department(Department),
    /// In the club's place for its director of football.
    DirectorOfFootball,
}

/// The job code of a director of football.
pub const DIRECTOR_OF_FOOTBALL: u8 = 10;

/// The jobs the editor gives and takes away, by contract code (see [`crate::job_name`]), with where each puts a member
/// of staff: the department lists that hold most of the game's staff of that job (all of them, for most). A manager,
/// the board and jobs the editor cannot name are left as they are.
pub const STAFF_JOBS: [(u8, Post); 20] = [
    (2, Post::Department(Department::Coaching)),  // Coach
    (20, Post::Department(Department::Coaching)), // Assistant Coach
    (22, Post::Department(Department::Coaching)), // Set Piece Coach
    (26, Post::Department(Department::Coaching)), // Fitness Coach, some of whom the medical team lists too
    (34, Post::Department(Department::Coaching)), // Goalkeeping Coach
    (60, Post::Department(Department::Coaching)), // Performance Analyst
    (62, Post::Department(Department::Coaching)), // Head Performance Analyst
    (64, Post::Department(Department::Coaching)), // Head of Youth Development
    (12, Post::Department(Department::Medical)),  // Physio
    (38, Post::Department(Department::Medical)),  // Chief Doctor
    (40, Post::Department(Department::Medical)),  // Head of Sports Science
    (46, Post::Department(Department::Medical)),  // Doctor
    (48, Post::Department(Department::Medical)),  // Sports Scientist
    (50, Post::Department(Department::Medical)),  // Head Physio
    (14, Post::Department(Department::Scouting)), // Scout
    (44, Post::Department(Department::Scouting)), // Chief Scout
    (58, Post::Department(Department::Scouting)), // Recruitment Analyst
    (86, Post::Department(Department::Scouting)), // Loan Manager
    (88, Post::Department(Department::Scouting)), // Technical Director
    (DIRECTOR_OF_FOOTBALL, Post::DirectorOfFootball),
];

/// Where a job the editor gives and takes away puts a member of staff.
pub fn post_of(job: u8) -> Option<Post> {
    STAFF_JOBS.iter().find(|&&(code, _)| code == job).map(|&(_, post)| post)
}

/// How many bytes of a club, and of each of its teams, are looked through for a pointer to a member of staff.
const CLUB_BYTES: usize = 0x170;
const TEAM_BYTES: usize = 0x800;

/// The bytes of a basic contract (`db::BASIC_CONTRACT`): up to and with the job.
const BASIC_CONTRACT_BYTES: u64 = 0x28;

/// What the contract the editor makes for a member of staff it signs says, as a plan has it: for the window to show
/// before it is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewStaffContract {
    /// Pounds per week.
    pub wage: i64,
    /// The end date, as a number like 20290630.
    pub expires: i64,
}

/// A move of a member of staff, a new job or a signing, worked out from the game as it is now and ready to be written.
#[derive(Debug, Clone)]
pub struct StaffPlan {
    pub member: u32,
    /// The club he leaves; 0 for one signed, who had none.
    pub from_club: u32,
    /// The club he moves to; his own for a new job.
    pub to_club: u32,
    /// The job he has (0 for one signed), and the one he will have.
    pub job: (u8, u8),
    /// Whether a department list he joins is grown into memory of the editor's own, its block having no room.
    pub grows: bool,
    /// For one signed, the contract the editor makes for him.
    pub contract: Option<NewStaffContract>,
    patches: Vec<Patch>,
    grow: Vec<Growth>,
}

/// A move, a new job or a signing that was written: what undoing it takes.
#[derive(Debug, Clone)]
pub struct StaffChange {
    pub member: u32,
    pub from_club: u32,
    pub to_club: u32,
    pub job: (u8, u8),
    /// Whether a department list was grown.
    pub grew: bool,
    patches: Vec<Patch>,
}

/// What ties a member of staff to his club, checked.
struct Holder {
    object: u64,
    contract: u64,
    /// The contract's bytes, as read.
    record: Vec<u8>,
    /// Whether the contract is a full one, with dates, rather than a basic one.
    full: bool,
    club: u64,
    club_uid: u32,
    job: u8,
    /// Each department list of the club that holds him: the department, the list, where in it he is, what it holds.
    lists: Vec<(Department, PointerList, usize, Vec<u64>)>,
    /// Whether the club's place for its director of football holds him.
    director: bool,
}

impl Session {
    /// The jobs the editor gives and takes away in this game: a director of football's only where the layout places
    /// a club's.
    pub fn staff_jobs(&self) -> Vec<u8> {
        STAFF_JOBS
            .iter()
            .filter(|&&(_, post)| post != Post::DirectorOfFootball || self.layout.club.director_of_football.is_some())
            .map(|&(code, _)| code)
            .collect()
    }

    /// Where `job` puts a member of staff in this game; refused for a job the editor does not give.
    fn post(&self, job: u8) -> Result<Post, MoveError> {
        match post_of(job) {
            Some(Post::DirectorOfFootball) if self.layout.club.director_of_football.is_none() => {
                Err(MoveError::UnusualJob { job })
            }
            Some(post) => Ok(post),
            None => Err(MoveError::UnusualJob { job }),
        }
    }

    /// Works out moving `member` to `club` on his contract dated from today: keeping his job, in the departments he
    /// works in, or as `job` where it is. Nothing is written.
    pub fn plan_staff_move(
        &self,
        member: &StaffSummary,
        club: &ClubSummary,
        job: Option<u8>,
    ) -> Result<StaffPlan, MoveError> {
        let holder = self.staff_holder(member)?;
        if club.address == holder.club {
            return Err(MoveError::SameClub);
        }
        let senior = self.joining_club(club, Some(holder.club))?;
        let job = job.unwrap_or(holder.job);

        let (mut patches, mut grow) = (Patches::default(), Vec::new());
        if job == holder.job {
            for (department, list, index, elements) in &holder.lists {
                self.join_post(club.address, Post::Department(*department), holder.object, &mut patches, &mut grow)?;
                removal_patches(list, *index, elements, &mut patches);
            }
            if holder.director {
                self.leave_director(holder.club, holder.object, &mut patches)?;
                self.join_post(club.address, Post::DirectorOfFootball, holder.object, &mut patches, &mut grow)?;
            }
        } else {
            // His job, not where he works now, says where he works at the new club.
            self.post(holder.job)?;
            let post = self.post(job)?;
            self.join_post(club.address, post, holder.object, &mut patches, &mut grow)?;
            self.leave_all(&holder, &mut patches)?;
        }
        self.staff_contract_patches(&holder, Some(senior), job, &mut patches);
        Ok(StaffPlan {
            member: member.uid,
            from_club: holder.club_uid,
            to_club: club.uid,
            job: (holder.job, job),
            grows: !grow.is_empty(),
            contract: None,
            patches: patches.0,
            grow,
        })
    }

    /// Works out giving `member` the job `job` at his club: he leaves the departments, or the director of football's
    /// place, the job is not in, and joins where it is. Nothing is written.
    pub fn plan_staff_job(&self, member: &StaffSummary, job: u8) -> Result<StaffPlan, MoveError> {
        let holder = self.staff_holder(member)?;
        self.post(holder.job)?;
        let post = self.post(job)?;

        let (mut patches, mut grow) = (Patches::default(), Vec::new());
        if job != holder.job {
            for (from, list, index, elements) in &holder.lists {
                if post != Post::Department(*from) {
                    removal_patches(list, *index, elements, &mut patches);
                }
            }
            if holder.director && post != Post::DirectorOfFootball {
                self.leave_director(holder.club, holder.object, &mut patches)?;
            }
            let there = match post {
                Post::Department(department) => holder.lists.iter().any(|(from, ..)| *from == department),
                Post::DirectorOfFootball => holder.director,
            };
            if !there {
                self.join_post(holder.club, post, holder.object, &mut patches, &mut grow)?;
            }
            self.staff_contract_patches(&holder, None, job, &mut patches);
        }
        Ok(StaffPlan {
            member: member.uid,
            from_club: holder.club_uid,
            to_club: holder.club_uid,
            job: (holder.job, job),
            grows: !grow.is_empty(),
            contract: None,
            patches: patches.0,
            grow,
        })
    }

    /// Works out signing `member`, who has no club, to `club` as `job` under a contract the editor makes on `terms`:
    /// a slot of the game's own pool of contracts (see `object_pool.rs`) holding a copy of the full contract of the
    /// member of the club's staff the job is most like his (the same job, else one in the same department, else any),
    /// whose current ability is nearest his, with:
    /// - him as its owner, and the club's senior team as his employer, with the job;
    /// - the wage given, or the one it is modelled on;
    /// - today as the day he signed and joined, and the end date given, or 30 June at the end of next season;
    /// - none of the other's clauses, bonuses, reasons to be unhappy, or other records of its own
    ///   ([`crate::ContractLayout::cleared`]).
    ///
    /// He then joins where the job is (see [`STAFF_JOBS`]), and points at the contract. Nothing is written.
    pub fn plan_staff_signing(
        &self,
        member: &StaffSummary,
        club: &ClubSummary,
        job: u8,
        terms: MoveTerms,
    ) -> Result<StaffPlan, MoveError> {
        let (process, layout) = (&self.process, &self.layout);
        let s = &layout.staff;
        let (Some(size), Some(pools)) = (layout.contract.size, layout.pool.as_ref()) else {
            return Err(MoveError::NoPool);
        };
        let today = self.game_date().ok_or(MoveError::NoDate)?;
        self.check_terms(terms, Some(today))?;
        if member.is_human || member.shift != 0 {
            return Err(MoveError::You);
        }
        let object = member.address;
        if process.read_u32(object + s.uid)? != member.uid {
            return Err(MoveError::Moved { uid: member.uid });
        }
        if process.read_u64(object + s.contract)? != 0 {
            return Err(MoveError::UnusualContract);
        }
        let women = process.read_bytes(club.address + layout.club.women, 1)?[0] != 0;
        if member.woman.is_some_and(|woman| woman != women) {
            return Err(MoveError::MenAndWomen);
        }
        let senior = self.joining_club(club, None)?;
        let post = self.post(job)?;
        // Where he joins first: a club's place for a director of football that is taken refuses him before the pool
        // is looked at.
        let (mut joining, mut grow) = (Patches::default(), Vec::new());
        self.join_post(club.address, post, object, &mut joining, &mut grow)?;

        let model = self.staff_model_contract(club.address, senior, member, job, post)?;
        let pool = self.pool_holding(model, size)?;
        let taken = pool.take(process, pools)?;
        let model = process.read_bytes(model, size as usize)?;
        let contract = self.new_staff_contract(model, object, senior, job, terms, today);
        let c = &layout.contract;
        let field = |offset: u64, kind: Kind| kind.decode(&contract[offset as usize..offset as usize + 4]);
        let made = NewStaffContract { wage: field(c.wage, Kind::I32), expires: field(c.expires, Kind::Date) };

        let mut patches = Patches::default();
        patches.push(taken.pool.address, taken.pool.before, taken.pool.after);
        patches.push(taken.slot, taken.was, contract);
        patches.0.extend(joining.0);
        patches.push(object + s.contract, 0u64.to_le_bytes(), taken.slot.to_le_bytes());
        Ok(StaffPlan {
            member: member.uid,
            from_club: 0,
            to_club: club.uid,
            job: (0, job),
            grows: !grow.is_empty(),
            contract: Some(made),
            patches: patches.0,
            grow,
        })
    }

    /// Writes a plan, each write over the bytes it expects, after checking them all. A department list to grow gets
    /// its buffer first, and is pointed at it before the rest is written.
    pub fn apply_staff_plan(&self, plan: &StaffPlan) -> Result<StaffChange, MoveError> {
        let mut patches = plan.grow.iter().map(|growth| self.grown_list(growth)).collect::<Result<Vec<_>, _>>()?;
        patches.extend(plan.patches.iter().cloned());
        self.apply_patches(&patches)?;
        let StaffPlan { member, from_club, to_club, job, grows, .. } = *plan;
        Ok(StaffChange { member, from_club, to_club, job, grew: grows, patches })
    }

    /// Puts the member of staff back as he was, provided memory still holds everything the change wrote: for one
    /// signed, with no club again, and the contract's slot free again, first in the pool's chain.
    pub fn undo_staff_change(&self, done: &StaffChange) -> Result<(), MoveError> {
        self.undo_patches(&done.patches)
    }

    /// The senior team of `club`, which a member of staff of a club like `from` (men's or women's), if any, joins.
    fn joining_club(&self, club: &ClubSummary, from: Option<u64>) -> Result<u64, MoveError> {
        let (process, layout) = (&self.process, &self.layout);
        if process.read_u32(club.address + layout.club.uid)? != club.uid {
            return Err(MoveError::NotAClub { uid: club.uid });
        }
        if let Some(from) = from {
            let women = |address: u64| process.read_bytes(address + layout.club.women, 1).map(|b| b[0]);
            if women(from)? != women(club.address)? {
                return Err(MoveError::MenAndWomen);
            }
        }
        Ok(self.senior_team(club.address, club.uid)?.0)
    }

    /// Checks what ties `member` to his club, and finds every department list of it that holds him, and whether its
    /// place for a director of football does.
    fn staff_holder(&self, member: &StaffSummary) -> Result<Holder, MoveError> {
        let (process, layout) = (&self.process, &self.layout);
        let (s, c) = (&layout.staff, &layout.contract);
        if member.is_human || member.shift != 0 {
            return Err(MoveError::You);
        }
        let object = member.address;
        if process.read_u32(object + s.uid)? != member.uid {
            return Err(MoveError::Moved { uid: member.uid });
        }
        let contract = process.read_u64(object + s.contract)?;
        if !is_user_pointer(contract) {
            return Err(MoveError::Unemployed);
        }
        let full = self.is_full_contract(contract);
        let record = process.read_bytes(contract, if full { c.end() } else { BASIC_CONTRACT_BYTES } as usize)?;
        let word =
            |offset: u64| u64::from_le_bytes(record[offset as usize..offset as usize + 8].try_into().expect("8 bytes"));
        let job = record[c.job as usize];
        let (team, senior) = (word(c.team), word(c.senior_team));
        if word(c.owner) != object + s.identity() || !is_user_pointer(team) || !is_user_pointer(senior) {
            return Err(MoveError::UnusualContract);
        }
        // A player, or a player-coach (a coaching job's code plus one), is moved as a player or not at all.
        if job == 1 || (job > 1 && job % 2 == 1) {
            return Err(MoveError::PlayerCoach);
        }
        let club = process.read_u64(senior + layout.team.club)?;
        if !is_user_pointer(club) || process.read_u64(team + layout.team.club)? != club {
            return Err(MoveError::UnusualContract);
        }
        let club_uid = process.read_u32(club + layout.club.uid)?;

        let mut lists = Vec::new();
        for department in DEPARTMENTS {
            let Ok((list, elements)) = self.department_list(club, department) else {
                continue;
            };
            let held: Vec<usize> = elements.iter().enumerate().filter(|&(_, &e)| e == object).map(|(i, _)| i).collect();
            match held[..] {
                [] => {}
                [index] => lists.push((department, list, index, elements)),
                _ => return Err(MoveError::NotInDepartment),
            }
        }
        // Only a director of football is moved out of the club's place for one: someone else who does that job too,
        // a manager for one, is the game's to move.
        let director = self.director_of(club)? == Some(object);
        if director && job != DIRECTOR_OF_FOOTBALL {
            return Err(MoveError::StaffRole);
        }
        if lists.is_empty() && !director {
            // A manager or a member of the board is in none of them: his job, not the lists, is why he stays; so is a
            // director of football where the layout does not place a club's.
            return Err(match self.post(job) {
                Ok(_) => MoveError::NotInDepartment,
                Err(err) => err,
            });
        }
        self.check_unheld(club, object, object + s.identity(), object + s.person_block)?;
        Ok(Holder { object, contract, record, full, club, club_uid, job, lists, director })
    }

    /// Whether the contract at `contract` is a full one (`db::FULL_CONTRACT`), with dates, as the game's own class
    /// names it.
    fn is_full_contract(&self, contract: u64) -> bool {
        crate::rtti::class_of(&self.process, &self.plugin, contract)
            .is_some_and(|class| class.contains("FULL_CONTRACT"))
    }

    /// The club's list of `department`, and what it holds; an empty one where the club has no one in it yet.
    fn department_list(&self, club: u64, department: Department) -> Result<(PointerList, Vec<u64>), MoveError> {
        let list = PointerList::read_or_empty(&self.process, club + department.offset(&self.layout))?
            .ok_or(MoveError::DepartmentFull { department: department.name(), staff: 0 })?;
        let elements = list.elements(&self.process)?;
        Ok((list, elements))
    }

    /// Who the club at `club` has in its place for a director of football: the object it points at, `None` for no one
    /// or where the layout does not place it.
    fn director_of(&self, club: u64) -> Result<Option<u64>, MoveError> {
        let Some(offset) = self.layout.club.director_of_football else {
            return Ok(None);
        };
        let held = self.process.read_u64(club + offset)?;
        Ok((held != 0).then_some(held))
    }

    /// Puts `object` where `post` is at the club at `club`: into a department's list (see
    /// [`Session::join_department`]), or into its place for a director of football, which must be empty.
    fn join_post(
        &self,
        club: u64,
        post: Post,
        object: u64,
        patches: &mut Patches,
        grow: &mut Vec<Growth>,
    ) -> Result<(), MoveError> {
        match post {
            Post::Department(department) => {
                let joining = self.department_list(club, department)?;
                if joining.1.contains(&object) {
                    return Err(MoveError::NotInDepartment);
                }
                self.join_department(&joining, object, department, patches, grow)
            }
            Post::DirectorOfFootball => {
                let offset =
                    self.layout.club.director_of_football.ok_or(MoveError::UnusualJob { job: DIRECTOR_OF_FOOTBALL })?;
                match self.director_of(club)? {
                    None => {
                        patches.push(club + offset, 0u64.to_le_bytes(), object.to_le_bytes());
                        Ok(())
                    }
                    Some(held) if held == object => Err(MoveError::NotInDepartment),
                    Some(held) => {
                        let uid = self.process.read_u32(held + self.layout.staff.uid).unwrap_or(0);
                        Err(MoveError::DirectorTaken { uid })
                    }
                }
            }
        }
    }

    /// Takes `object` out of the place for a director of football of the club at `club`, which holds him.
    fn leave_director(&self, club: u64, object: u64, patches: &mut Patches) -> Result<(), MoveError> {
        let offset = self.layout.club.director_of_football.ok_or(MoveError::StaffRole)?;
        patches.push(club + offset, object.to_le_bytes(), 0u64.to_le_bytes());
        Ok(())
    }

    /// Takes the member of staff `holder` describes out of every place at his club that holds him.
    fn leave_all(&self, holder: &Holder, patches: &mut Patches) -> Result<(), MoveError> {
        for (_, list, index, elements) in &holder.lists {
            removal_patches(list, *index, elements, patches);
        }
        if holder.director {
            self.leave_director(holder.club, holder.object, patches)?;
        }
        Ok(())
    }

    /// Puts `object` into the list of `department` (as read, with what it holds): after them where its block has room,
    /// or else in the list grown (see the module's notes).
    fn join_department(
        &self,
        (list, elements): &(PointerList, Vec<u64>),
        object: u64,
        department: Department,
        patches: &mut Patches,
        grow: &mut Vec<Growth>,
    ) -> Result<(), MoveError> {
        if list.len() < list.room(&self.process, &self.layout.heap)? {
            return self.append_patches(list, object, patches);
        }
        let mut bytes: Vec<u8> = elements.iter().flat_map(|element| element.to_le_bytes()).collect();
        bytes.extend(object.to_le_bytes());
        let full = MoveError::DepartmentFull { department: department.name(), staff: list.len() };
        grow.push(self.growth(list.header(), list.words(), bytes, 8).ok_or(full)?);
        Ok(())
    }

    /// Fails when the club or one of its teams points at the member of staff (his object, identity or person block)
    /// itself, rather than through a department list or its place for a director of football: such a role is the
    /// game's to move.
    fn check_unheld(&self, club: u64, object: u64, identity: u64, person: u64) -> Result<(), MoveError> {
        let process = &self.process;
        let director = self.layout.club.director_of_football;
        let mut places = vec![(club, CLUB_BYTES)];
        if let Some(teams) = PointerList::read(process, club + self.layout.club.teams)? {
            places
                .extend(teams.elements(process)?.into_iter().filter(|&t| is_user_pointer(t)).map(|t| (t, TEAM_BYTES)));
        }
        for (address, len) in places {
            let bytes = process.read_bytes(address, len)?;
            let held = bytes
                .as_chunks::<8>()
                .0
                .iter()
                .enumerate()
                .filter(|&(i, _)| address != club || director != Some(i as u64 * 8))
                .map(|(_, w)| u64::from_le_bytes(*w))
                .any(|w| w == object || w == identity || w == person);
            if held {
                return Err(MoveError::StaffRole);
            }
        }
        Ok(())
    }

    /// The contract of the member of staff `holder` describes: his new club's senior team from today, for a move;
    /// the job `job`. A basic contract has no dates to write.
    fn staff_contract_patches(&self, holder: &Holder, senior: Option<u64>, job: u8, patches: &mut Patches) {
        let c = &self.layout.contract;
        let Holder { contract, ref record, full, .. } = *holder;
        let at = |offset: u64, len: usize| &record[offset as usize..offset as usize + len];
        if let Some(senior) = senior {
            for offset in [c.team, c.senior_team] {
                patches.push(contract + offset, at(offset, 8), senior.to_le_bytes());
            }
            if let (true, Some(today)) = (full, self.game_date()) {
                for offset in [c.signed, c.joined] {
                    // A date the game has not set stays unset.
                    if Kind::Date.decode(at(offset, 4)) != 0 {
                        patches.push(
                            contract + offset,
                            at(offset, 4),
                            Kind::Date.encode(today.to_number(), at(offset, 4)),
                        );
                    }
                }
            }
        }
        patches.push(contract + c.job, at(c.job, 1), [job]);
    }

    /// The full contract of a member of the staff of the club at `club`, whose senior team is `senior`, that a new one
    /// for `member` as `job` (at `post`) is modelled on: of those the club's department lists and its place for a
    /// director of football hold, under a full contract of their own with the club, the ones with the same job, else
    /// those where `post` is, else all of them; of those the one whose current ability is nearest his, the first on a
    /// tie.
    fn staff_model_contract(
        &self,
        club: u64,
        senior: u64,
        member: &StaffSummary,
        job: u8,
        post: Post,
    ) -> Result<u64, MoveError> {
        let (process, layout) = (&self.process, &self.layout);
        let (s, c) = (&layout.staff, &layout.contract);
        let mut staff: Vec<(u64, Post)> = Vec::new();
        for department in DEPARTMENTS {
            if let Ok((_, elements)) = self.department_list(club, department) {
                staff.extend(elements.into_iter().map(|object| (object, Post::Department(department))));
            }
        }
        if let Some(director) = self.director_of(club)? {
            staff.push((director, Post::DirectorOfFootball));
        }
        // The nearest of each kind: the same job, the same post, any; each the distance in ability and the contract.
        let mut nearest: [Option<(u16, u64)>; 3] = [None; 3];
        for (object, at) in staff {
            let Ok(contract) = process.read_u64(object + s.contract) else {
                continue;
            };
            if !is_user_pointer(contract) || !self.is_full_contract(contract) {
                continue;
            }
            let Ok(record) = process.read_bytes(contract, c.end() as usize) else {
                continue;
            };
            let word = |offset: u64| {
                u64::from_le_bytes(record[offset as usize..offset as usize + 8].try_into().expect("8 bytes"))
            };
            let theirs = record[c.job as usize];
            let plain = word(c.owner) == object + s.identity()
                && word(c.senior_team) == senior
                && process.read_u64(word(c.team) + layout.team.club).is_ok_and(|of| of == club)
                && post_of(theirs).is_some();
            let Ok(ability) = process.read_bytes(object + s.current_ability, 2) else {
                continue;
            };
            if !plain {
                continue;
            }
            let distance = u16::from_le_bytes([ability[0], ability[1]]).abs_diff(member.current_ability);
            let kinds = [theirs == job, at == post, true];
            for (best, fits) in nearest.iter_mut().zip(kinds) {
                if fits && best.is_none_or(|(near, _)| distance < near) {
                    *best = Some((distance, contract));
                }
            }
        }
        nearest.into_iter().flatten().next().map(|(_, contract)| contract).ok_or(MoveError::NoStaffModel)
    }

    /// The bytes of a new contract for the member of staff `object` with the senior team `senior` as `job`, on
    /// `terms`, made from `model`'s (see [`Session::plan_staff_signing`]).
    fn new_staff_contract(
        &self,
        model: Vec<u8>,
        object: u64,
        senior: u64,
        job: u8,
        terms: MoveTerms,
        today: FmDate,
    ) -> Vec<u8> {
        let (s, c) = (&self.layout.staff, &self.layout.contract);
        let at = |offset: u64, len: usize| offset as usize..offset as usize + len;
        let mut bytes = model.clone();
        let mut put = |offset: u64, value: &[u8]| bytes[at(offset, value.len())].copy_from_slice(value);
        put(c.owner, &(object + s.identity()).to_le_bytes());
        put(c.team, &senior.to_le_bytes());
        put(c.senior_team, &senior.to_le_bytes());
        put(c.job, &[job]);
        // The dates keep the flags the model's have.
        for offset in [c.signed, c.joined] {
            put(offset, &Kind::Date.encode(today.to_number(), &model[at(offset, 4)]));
        }
        let expires = terms.expires.unwrap_or_else(|| default_expiry(today));
        put(c.expires, &Kind::Date.encode(expires, &model[at(c.expires, 4)]));
        if let Some(wage) = terms.wage {
            put(c.wage, &Kind::I32.encode(wage, &model[at(c.wage, 4)]));
        }
        put(c.loyalty_bonus, &0i32.to_le_bytes());
        put(c.squad_number, &[NO_SQUAD_NUMBER]);
        put(c.listing, &[model[c.listing as usize] & !LISTED]);
        put(c.unhappiness, &[0; 8]);
        put(c.clauses, &[0; 24]);
        put(c.competition_bonuses, &[0; 24]);
        for &offset in &c.cleared {
            put(offset, &[0; 8]);
        }
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_job_has_one_post_and_none_is_a_player_coach() {
        for (i, &(code, _)) in STAFF_JOBS.iter().enumerate() {
            assert!(code > 1 && code % 2 == 0, "{code}");
            assert!(crate::job_name(code).is_some(), "{code}");
            assert!(!STAFF_JOBS[i + 1..].iter().any(|&(other, _)| other == code), "{code}");
        }
        assert_eq!(post_of(26), Some(Post::Department(Department::Coaching)));
        assert_eq!(post_of(38), Some(Post::Department(Department::Medical)));
        assert_eq!(post_of(62), Some(Post::Department(Department::Coaching)));
        assert_eq!(post_of(88), Some(Post::Department(Department::Scouting)));
        assert_eq!(post_of(DIRECTOR_OF_FOOTBALL), Some(Post::DirectorOfFootball));
        assert_eq!(post_of(16), None, "a manager is left as he is");
        assert_eq!(post_of(4), None, "so is the board");
    }

    #[test]
    fn a_basic_contract_ends_with_the_job() {
        let layout = crate::layout_for(27).expect("FM27 layout");
        let c = &layout.contract;
        assert!(c.job < BASIC_CONTRACT_BYTES && c.wage + 4 <= BASIC_CONTRACT_BYTES);
        assert!(c.team + 8 <= BASIC_CONTRACT_BYTES && c.senior_team + 8 <= BASIC_CONTRACT_BYTES);
        assert!(c.owner + 8 <= BASIC_CONTRACT_BYTES);
    }

    #[test]
    fn the_director_of_footballs_place_is_in_the_club_bytes_looked_through() {
        let layout = crate::layout_for(27).expect("FM27 layout");
        let at = layout.club.director_of_football.expect("placed on Windows");
        assert!(at + 8 <= CLUB_BYTES as u64, "check_unheld must skip it, not miss it");
    }
}
