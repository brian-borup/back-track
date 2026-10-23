# Back Track

A Progressive Web App party game in the spirit of Hitster: a chart topper plays and everyone guesses what year it came out.

**Use it:** https://brian-borup.github.io/back-track/

On an iPhone, open that link in Safari, tap **Share → Add to Home Screen**. It then runs full-screen. Games are saved only on the device.

## Playing

- **Timeline:** everyone starts with one song card showing its year. On your turn a mystery song plays and you tap where it fits in your timeline. Place it right and you keep the card. The first player to collect the target number of cards wins.
- **Guess the year:** everyone guesses the year of each song. Exact scores 3, within 2 years scores 2, within 5 years scores 1. Most points after the last round wins.
- Choose which decades to play from, from the 1950s to today.

## Music

Each song plays as a 30-second preview clip from Apple, right in the app, with the title, artist and artwork hidden until the guesses are in. The lock screen and Control Center show it as "Mystery song". No account is needed, but it does need an internet connection. If Apple has no clip for a song, the app quietly swaps in another one.

## Songs

The song list lives in `tools/song-list.js` as `[year, title, artist]`. The year is when the song was first released as a single. After editing it, run:

```
node tools/resolve-ids.js
```

This looks up each song's Apple Music track id (so the app plays the original recording and not a cover) and rebuilds `songs.js`. Lookups are cached in `tools/ids-cache.json`, so only new songs are searched. Apple allows about 20 searches a minute, so a full rebuild takes around half an hour. At the end the script lists songs it couldn't find and any years that look wrong.

## Developing

Plain HTML, CSS and JavaScript, no build step.

```
node serve.js
```

then open http://localhost:8081. When you change any app file, bump `CACHE` in `sw.js` so installed copies pick up the update.
