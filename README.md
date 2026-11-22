# Spire Buddy

A phone-first Slay the Spire 2 reference, installable to the iPhone home screen.

- **Enemies**: HP and move patterns scaled to the ascension you pick (A0–A10), turn by turn, with Strength stacking; random moves with their odds; position-based openers.
- **Fights**: every encounter by act (Overgrowth and Underdocks kept separate), weak / normal / elite / boss, with the whole fight's patterns on one page.
- **Cards**: every card (all characters, colorless, event, status, curse, token) with base and upgraded text.
- **Relics**: rarity, pool, and for event relics the event and act they come from; ancient relics show their Ancient.
- **More**: events with options, potions, powers, ascension levels, characters, latest patch changes.
- **Main / Beta** toggle in the header.

## Data

`tools/build_data.py` pulls the extracted game data from [Spire Codex](https://github.com/ptrlrd/spire-codex)
(`data/eng` for main, `data-beta/latest` for the Steam public beta) and writes `data/main.json`, `data/beta.json`, `data/meta.json`.
A GitHub Action runs it every 3 hours and commits only when a patch changed something.

`tools/game_code.py` reads the installed game's `sts2.dll` for things Spire Codex doesn't have: which event grants
which relic/card (`data/event_sources.json`; many are only granted in code), and the exact ascension level and
Dread-mode value of every monster number (`data/monster_code.json`). `build_data.py` merges both in.
A launchd agent on the Mac (`com.spirecompanion.eventsources`, working copy in `~/Library/Application Support/sts2-companion-sync/`)
re-runs it whenever Steam updates the game, daily and at login, and pushes when anything changed; that push triggers the Action.
Manual run: `pip install dnfile && python3 tools/game_code.py`.

The Action also pulls the latest Neowsletter from Steam's news feed into `data/news.json`.

## Ascension scaling

Each value switches at the level the game code uses (HP and block mostly A8, damage A9).
Past A10 the stepper reaches **Dread** (beta only): the boss buffs from the game code, plus each enemy's Dominion.

## Local preview

`python3 -m http.server 8260` and open http://localhost:8260 (the service worker is skipped on localhost).
Bump `CACHE` in `sw.js` after changing any app-shell file.
