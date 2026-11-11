# Contributing

Thanks for helping with FMLibreEditor! Everyone is welcome, whatever you know about Rust, React or
Football Manager's insides. If something here is unclear, that is a bug in this file: ask in
[Discussions](https://github.com/tozmoz/FMLibreEditor/discussions) and it gets fixed.

Please follow the [code of conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug or ask for a feature:** open an
  [issue](https://github.com/tozmoz/FMLibreEditor/issues/new/choose). For a bug, say which version
  of the app you use and where you run FM27 (Game Pass, Steam or macOS). If the app connects to
  the game, paste what Copy diagnostics, at the foot of its window, copies (versions later than
  0.5.0 have it).
- **Ask a question or share an idea:**
  [Discussions](https://github.com/tozmoz/FMLibreEditor/discussions).
- **Test:** run the latest release on your storefront and say what works and what does not. A
  check on a platform the maintainer does not have is as useful as code.
- **Research:** where FM27 keeps a value, what a field means, how it changes in game. Open an
  issue with what you found and how you checked it (the build of the game, the save, what the
  game's screen shows). [docs/recon](docs/recon) holds what is known so far.
- **Code, translations and docs:** below.

## Your first pull request

1. Find an issue labelled
   [help wanted](https://github.com/tozmoz/FMLibreEditor/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22),
   or any open issue you would like to work on, and comment that you would like to take it. The maintainer assigns it to you, so nobody else
   starts the same work. For something without an issue, open one first when it is more than a
   small fix, so we can agree on the approach before you spend time on it.
2. Fork the repository and make a branch.
3. Build and run it: [docs/DEVELOPING.md](docs/DEVELOPING.md#building). For work on the interface
   you do not need the game: `npm install` and `npm run dev` in `app/` open the interface in a
   browser with made-up players (`app/src/dev/mock.ts`).
4. Open a pull request. A draft is fine if you want early feedback or are stuck: say what you
   are unsure about. The template asks how you checked it; having only one platform is fine.

CI runs the checks on every pull request, on Windows and macOS. To run them yourself first:

```sh
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cd app && npm run build
```

The project moves quickly. If `main` changes under your pull request, the maintainer can help
with the merge; do not let that stop you.

## Translating

The interface's text lives in `app/src/i18n/`: `en.ts` is English, with a comment on what each
string is for; `tr.ts`, `es.ts`, `id.ts`, `it.ts`, `ko.ts` and `zh-CN.ts` are Turkish, Spanish,
Indonesian, Italian, Korean and Simplified Chinese. To add a language:

1. Copy `en.ts` to a file named after the language's code (`de.ts` for German) and translate
   the strings. The build fails if a key is missing or extra, so you cannot miss one.
2. Add it to `LANGUAGES` in `app/src/i18n/index.ts`, with the tag its dates and numbers are
   formatted by (`de-DE`).
3. Add its name, in that language, to `LANGUAGES` in `app/src/SettingsMenu.tsx`.

`npm run dev` shows it in the browser; pick it from the settings menu. Fixing a word in an
existing translation is welcome too.

## Code that writes to the game

Every write to the game goes through the guarded patches described in
[docs/DEVELOPING.md](docs/DEVELOPING.md). A change that writes somewhere new should say how the
offset was found; a field needs two independent confirmations before it becomes writable.
Test such changes on an offline save you have backed up.

## License

By contributing you agree that your work is published under the project's
[GPL-3.0-or-later](LICENSE) license.
