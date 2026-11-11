//! The report the app's Copy diagnostics puts on the clipboard, for a bug report: the app and the system, the game and
//! its build, where the editor found the game's data and how many of its samples decoded, and what its checks found,
//! as plain text. It is in English whatever the language of the app, for whoever reads the report, and the probe
//! prints the same lines. Nothing in it tells who the user is: no names of people or clubs, no save, and no paths, as
//! the game's path holds the account's name on macOS.

use crate::game::GAME_PLUGIN;
use crate::health::iso;
use crate::session::{IGNORE_PROFILES, Session, profiles_ignored};

/// The report on the game `session` is connected to, from FMLibreEditor `version`. The checks are as they last ran,
/// when the app connected or reloaded: what the editor goes by now. Only reads memory.
pub fn diagnostics_report(session: &Session, version: &str) -> String {
    let mut lines = vec![
        format!("FMLibreEditor {version} on {} {}", system(), std::env::consts::ARCH),
        format!("Game: {}", session.game.name()),
        format!("{GAME_PLUGIN} build: {}", session.fingerprint),
        profile_line(session),
        writing_line(session),
        format!("In-game date: {}", date_line(session)),
        format!("Retirement manager: {}", retirement_line(session)),
    ];
    lines.extend(session.arrays.describe());
    lines.push("Checks:".to_owned());
    lines.extend(session.health().results.iter().map(|result| format!("  {result}")));
    lines.join("\n") + "\n"
}

/// The in-game date, where it was read and how that place was found.
pub fn date_line(session: &Session) -> String {
    match session.date_place() {
        Some(place) => format!(
            "{} ({GAME_PLUGIN}+{:#x}, {})",
            session.game_date().map_or_else(|| "-".to_owned(), iso),
            place.rva,
            place.found.describe()
        ),
        None => "none (see the gameDate check)".to_owned(),
    }
}

/// Where the static pointer to the retirement manager is, and how it was found: looked for now when it was not before.
pub fn retirement_line(session: &Session) -> String {
    match session.retirement_place() {
        Some(place) => format!("{GAME_PLUGIN}+{:#x} ({})", place.rva, place.found.describe()),
        None => "not found".to_owned(),
    }
}

fn profile_line(session: &Session) -> String {
    match &session.profile {
        Some(profile) => format!("Build profile: {}", profile.name),
        None if profiles_ignored() => format!("Build profile: none, as {IGNORE_PROFILES} is set"),
        None => "Build profile: none for this build".to_owned(),
    }
}

/// Whether the system lets the app write to the game, and for a build without a profile, whether editing it was
/// allowed.
fn writing_line(session: &Session) -> String {
    let system = if session.process.can_write() {
        "the system lets the app write to the game"
    } else {
        "the system does not let the app write to the game"
    };
    let allowed = if session.known_build() {
        ""
    } else if session.writes_allowed() {
        "; editing this build was allowed (Edit anyway)"
    } else {
        "; editing this build is not allowed yet (Edit anyway)"
    };
    format!("Writing: {system}{allowed}")
}

fn system() -> &'static str {
    match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        other => other,
    }
}
