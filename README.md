# Spire Companion

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

`tools/event_sources.py` reads the installed game's `sts2.dll` to find which event grants which relic/card
(many event relics are only granted in code, not named in event text). It writes `data/event_sources.json`,
which `build_data.py` merges in. Run it after a patch that adds events: `pip install dnfile && python3 tools/event_sources.py`.

Images are loaded from the Spire Codex CDN and cached by the service worker. Game content © Mega Crit.

## Ascension scaling

HP uses the ascension values from A8 (Tough Enemies); attack damage and hit counts from A9 (Deadly Enemies).

## Local preview

`python3 -m http.server 8260` and open http://localhost:8260 (the service worker is skipped on localhost).
Bump `CACHE` in `sw.js` after changing any app-shell file.
