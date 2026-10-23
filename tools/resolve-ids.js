// Looks up each song in song-list.js on the iTunes Search API and writes
// songs.js with its Apple Music track id, so the app plays the original
// recording rather than a cover. Results are cached in ids-cache.json, so
// re-running only looks up new songs.
//
//   node tools/resolve-ids.js           (add --retry to search again for songs not found before,
//                                        or --check to list what would be searched without searching)
//
// Apple allows roughly 20 searches a minute, so a full run takes a while.
const fs = require('fs');
const path = require('path');

const list = require('./song-list');
const cacheFile = path.join(__dirname, 'ids-cache.json');
const outFile = path.join(__dirname, '..', 'songs.js');
const retryMisses = process.argv.includes('--retry');
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const unbracket = (t) => t.replace(/[([].*?[)\]]/g, '');
const baseTitle = (t) => (norm(unbracket(t)) || norm(t)).replace(/^the /, '');
const fullTitle = (t) => norm(t).replace(/^the /, '');
const artistName = (a) => norm(a).replace(/^the /, '');
const mainArtist = (a) => artistName(a.split(/ feat\. | & |, | and /i)[0]);
const junk = /karaoke|tribute|cover|instrumental|in the style of|made famous|originally performed|8-bit|lullaby|piano version|workout/i;

async function search(term, extra = '&limit=50') {
  const url = `https://itunes.apple.com/search?entity=song&country=US${extra}&term=${encodeURIComponent(term)}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url);
    if (res.ok) return (await res.json()).results;
    console.log(`  HTTP ${res.status}, waiting a minute…`);
    await sleep(60000);
  }
  throw new Error('iTunes kept refusing requests');
}

// Labels on a track name that still mean the original recording.
const harmless = /^(\d{4} )?(digital(ly)? )?remaster(ed)?( \d{4})?( version)?$|^(single|album|radio|lp|original|7|7 inch|45|mono|stereo|original 45 single|explicit|clean)( version| edit| mix)?$|^radio edit$|^edit$|^feat |^with |^from |^the official .* song$/;
// Does this Apple track look like the plain, original version of our song?
function accept(trackName, appleArtist, title, artist) {
  // Our main artist must appear in Apple's artist, e.g. "Buddy Holly & The Crickets".
  // …but not their son: "Hank Williams" must not match "Hank Williams, Jr.".
  const appleWords = ` ${artistName(appleArtist)} `;
  const ourWords = ` ${mainArtist(artist)} `;
  if (!appleWords.includes(ourWords) || appleWords.includes(`${ourWords}jr `)) return false;
  if (junk.test(trackName)) return false;
  // Look at each bracketed label, and anything after " - ".
  const labels = [...trackName.matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => norm(m[1]));
  const [plain, ...dash] = unbracket(trackName).split(/ - /);
  const ours = norm(title);
  // Any other label ("Remix", "Live", "Demo", a remixer's name, a translated
  // title…) means a different recording.
  for (const label of [...labels, ...dash.map(norm)]) {
    if (!label || ours.includes(label)) continue; // part of our own title, e.g. "(Sittin' On)"
    if (!harmless.test(label)) return false;
  }
  const t = fullTitle(plain);
  return t === baseTitle(title) || t === fullTitle(title);
}

function pick(results, title, artist) {
  const matches = results.filter((r) => r.previewUrl && r.trackName && r.artistName
    && accept(r.trackName, r.artistName, title, artist)
    && !junk.test(r.collectionName || ''));
  // Prefer our artist first (a solo recording over a duet), then a track
  // name with no labels at all, then the earliest release.
  const duet = (r) => (artistName(r.artistName).startsWith(mainArtist(artist)) ? 0 : 1);
  const labelled = (r) => (/[([]| - /.test(r.trackName) ? 1 : 0);
  matches.sort((x, y) => duet(x) - duet(y) || labelled(x) - labelled(y)
    || new Date(x.releaseDate) - new Date(y.releaseDate));
  return matches[0];
}

// Earlier runs used looser matching; re-check what they picked.
function cachedIsGood(c, title, artist) {
  if (!c || !c.id) return false;
  const at = c.found.lastIndexOf(' — ');
  return accept(c.found.slice(0, at), c.found.slice(at + 3), title, artist);
}

(async () => {
  if (process.argv.includes('--check')) {
    const redo = list.filter(([, t, a]) => !cachedIsGood(cache[`${t} — ${a}`], t, a))
      .map(([, t, a]) => `${t} — ${a}   [cached: ${(cache[`${t} — ${a}`] || {}).found || 'nothing'}]`);
    console.log(`${redo.length} songs need a search:\n  ${redo.join('\n  ')}`);
    return;
  }
  const missing = [];
  const suspicious = [];
  for (const [year, title, artist] of list) {
    const key = `${title} — ${artist}`;
    const c0 = cache[key];
    if (!c0 || (c0.id && !cachedIsGood(c0, title, artist)) || (retryMisses && !c0.id)) {
      let hit = pick(await search(`${baseTitle(title)} ${mainArtist(artist)}`), title, artist);
      if (!hit) {
        // Remix singles can crowd out the original; search song titles alone, more widely.
        await sleep(3200);
        hit = pick(await search(baseTitle(title), '&attribute=songTerm&limit=200'), title, artist);
      }
      cache[key] = hit
        ? { id: hit.trackId, released: hit.releaseDate.slice(0, 4), found: `${hit.trackName} — ${hit.artistName}` }
        : { id: null };
      fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
      console.log(`${hit ? 'ok  ' : 'MISS'} ${year} ${key}${hit ? `  →  ${cache[key].found} (${cache[key].released})` : ''}`);
      await sleep(3200);
    }
    const c = cache[key];
    if (!c.id) missing.push(key);
    // A release date earlier than our year suggests our year is wrong.
    else if (+c.released < year) suspicious.push(`${year} ${key}  (Apple says ${c.released}: ${c.found})`);
  }

  // Songs without a clean match are left out, so the game never plays a remix.
  const rows = list.filter(([, t, a]) => cache[`${t} — ${a}`].id)
    .map(([y, t, a]) => JSON.stringify([y, t, a, cache[`${t} — ${a}`].id]));
  fs.writeFileSync(outFile,
    '// Generated by tools/resolve-ids.js from tools/song-list.js — edit that file instead.\n' +
    '// Each song is [year, title, artist, Apple Music track id].\n' +
    `const SONGS = [\n${rows.join(',\n')}\n];\n`);

  console.log(`\nWrote ${rows.length} of ${list.length} songs to songs.js`);
  if (missing.length) console.log(`\nLeft out, no clean match on Apple Music (${missing.length}):\n  ${missing.join('\n  ')}`);
  if (suspicious.length) console.log(`\nCheck these years (${suspicious.length}):\n  ${suspicious.join('\n  ')}`);
})();
