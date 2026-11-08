# Security

FMLibreEditor reads and writes the memory of a running game, and updates itself from this
repository's releases, so a security problem in it matters.

## Reporting a problem

Please do not open a public issue for a vulnerability. Report it privately through the
repository's **Security** tab › **Report a vulnerability**. Say which version of the app you
use, where you run FM27 (Game Pass, Steam or macOS), and how to reproduce it.

You should hear back within a few days. Once a fix is released, the advisory is published and
credits you, unless you would rather not be named.

## Supported versions

Only the latest release gets fixes. The app updates itself from inside the app (on Windows and
macOS), so the fix reaches installed copies with the next release.

## What counts

For example: a way for a downloaded update, a graphics pack or a file the app reads to run code;
the app writing outside the guarded patches described in
[docs/DEVELOPING.md](docs/DEVELOPING.md); or the macOS bridge exposing the game's memory to other
processes.

A save corrupted by an edit is a bug, not a vulnerability: open an
[issue](https://github.com/tozmoz/FMLibreEditor/issues/new/choose) for it.
