# LinuxReader

An ebook reader for the Linux desktop — EPUB and PDF — built to feel like Apple Books:
six reading themes, fine-grained typography, four-colour highlights and notes,
a left sidebar for contents / bookmarks / highlights, a karaoke-style reading mode,
seamless scrolling, and sync of books and annotations to your own cloud (WebDAV) or a local folder.

**English** | [简体中文](README.md)

- Prebuilt deb: [`dist/linuxreader_1.0.8_amd64.deb`](dist/linuxreader_1.0.8_amd64.deb) (~68 MB, bundles the Electron runtime — install and run)
- Project: <https://github.com/shao-jun/LinuxReader>
- License: MIT © 2026 ftosoft

## Install

Download the deb from this repo (or build it yourself with `./build/build-deb.sh`), then:

```bash
sudo dpkg -i linuxreader_1.0.8_amd64.deb     # if dependencies are missing: sudo apt -f install
```

After installation **LinuxReader** appears in the application menu and `.epub` files open in it by default
(the system-wide default is written to `/etc/xdg/mimeapps.list`; your own `~/.config/mimeapps.list` still wins).
You can also use "Open with → LinuxReader" from your file manager, or the command line:

```bash
linuxreader book.epub        # open this book
linuxreader                  # open the library
```

Uninstall: `sudo dpkg -r linuxreader` (your data stays in `~/.local/share/linuxreader`; delete it manually).

## Features

**Library**: grid or list view, collections, tags, favourites, covers, search by title / author / tag,
import EPUB/PDF by drag and drop or via "Import books". The cover is taken from the EPUB metadata;
if a book has no cover metadata but its first page is a single full-page image, that image is used as the cover.

**Reading**
- EPUB and PDF (PDF is embedded as-is)
- Two reading modes: paged and continuous scroll; four page-turn effects: slide, page, fade, scroll
- Seamless scrolling: adjacent chapters are appended into the same document, so reaching the end of a
  chapter simply continues into the next one — no reload, no jump; chapters are pre-fetched in both
  directions while you scroll

**Typography (Aa panel)**
- Six themes: Original, Quiet, Paper, Bold, Calm, Focus — each with a full set of defaults
- Every setting still adjustable per theme: font family (serif / sans / kai / fangsong), bold toggle,
  size, line height, letter spacing, word spacing, page margins
- UI appearance: light / dark / follow system
- "Restore this theme's defaults" resets everything in one click

**Left sidebar** (open by default once a book is opened)
All three tabs sit on the left and reflow the text instead of covering it:
- Contents: indented chapter tree, current chapter highlighted, click to jump
- Bookmarks: ordered by position, removable
- Highlights: four-colour highlights, underlines and notes, filterable by all / with notes / highlights only

Clicking any entry jumps to it and shows "← Back to reading position" in the top-left of the reader.

**Notes**: selecting text pops up an action bar — yellow / green / blue / pink highlight, underline,
add note, copy, search. Highlights and notes are stored per book and travel with sync.

**Keyboard**: `←/→` or space to turn pages, `Ctrl+B` to toggle the sidebar, `B` to add a bookmark,
`Esc` closes overlays first, then goes back to the library (same as "‹ Library" in the top-left).

**Karaoke mode**: splits the current chapter into sentences, highlights them one by one and scrolls
them to the centre, like following lyrics; works together with system speech (`espeak-ng`) for read-along.

**Sync**: enter your own account in Settings, two options
- WebDAV: Nextcloud, Synology, Jianguoyun, … — URL + user + app password
- Local folder: any already-mounted cloud folder (UOS cloud drive, OneDrive folder, …)

Only books, covers, progress and annotations are synced; credentials are written only to
`~/.local/share/linuxreader/sync.json` on your machine.

## Run from source

```bash
npm install
npm start                 # requires Electron 33
npm run start:debug       # with --remote-debugging-port=9223, handy for CDP debugging
```

## Build

```bash
./build/build-deb.sh      # output in dist/
```

The script copies `node_modules/electron/dist` into `/opt/linuxreader`, puts `src/` and `package.json`
into `resources/app`, writes a `.desktop` file (with `MimeType=application/epub+zip;application/pdf;`
and `%F`) plus hicolor icons, and the postinst updates the desktop database and points the system-wide
EPUB default at LinuxReader.

## Layout

```
src/main/       main process: window, linuxreader:// protocol, import, EPUB unpacking, WebDAV sync, TTS
src/main/epub.js    dependency-free ZIP/EPUB parser + book HTML sanitizer (strips scripts)
src/renderer/   UI: library, reading engine, typography, highlights/notes, karaoke mode
build/          deb packaging script and icons
tools/          test utilities: test EPUB generator, CDP probe scripts
```

## Data

`~/.local/share/linuxreader`
└── books/<id>/{book.epub|book.pdf, src/, meta.json, annotations.json, cover.*}
└── library.json, settings.json, sync.json
