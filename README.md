# PDF Editor

A powerful browser-based PDF editor built with vanilla HTML, CSS, and JavaScript.

## Features

- **Open PDF** — drag & drop or browse
- **Add Text** — click anywhere to place text with custom font, size, and color
- **Freehand Draw** — draw directly on pages
- **Highlight** — highlight regions with adjustable color/opacity
- **Rectangle** — draw rectangles/borders
- **Whiteout / Redact** — cover content with white boxes
- **Insert Image** — add PNG/JPG images onto pages
- **Rotate Pages** — rotate left or right
- **Delete / Add Pages** — remove pages or add blank ones
- **Merge PDFs** — combine multiple PDFs into one
- **Undo / Redo** — full undo/redo support
- **Zoom** — zoom in/out, fit to width, Ctrl+scroll
- **Save** — download edited PDF with custom filename
- **PWA** — installable on desktop and mobile, works offline

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `V` | Select tool |
| `T` | Text tool |
| `D` | Draw tool |
| `H` | Highlight tool |
| `R` | Rectangle tool |
| `W` | Whiteout tool |
| `Ctrl+S` | Save |
| `Ctrl+O` | Open |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `+` / `-` | Zoom in / out |
| `0` | Fit to width |
| `← →` | Previous / Next page |

## Deploy

This app auto-deploys to GitHub Pages on every push to `main` via the included GitHub Actions workflow.

## Tech Stack

- [PDF.js](https://mozilla.github.io/pdf.js/) — PDF rendering
- [pdf-lib](https://pdf-lib.js.org/) — PDF editing & saving
- [fontkit](https://github.com/foliojs/fontkit) — font embedding
