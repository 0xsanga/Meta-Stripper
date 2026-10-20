# Agent Instructions

These rules apply to all work in this project.

1. Inspect the current directory and run `git status` before editing. Treat existing files and changes as user-owned, and preserve unrelated user work.
2. Keep image inspection, decoding, cleaning, verification, and export entirely client-side. User files must never be uploaded.
3. Do not add telemetry, analytics, remote image processing, runtime CDN dependencies, remote fonts, authentication, databases, API routes, or server actions.
4. Add focused tests for every metadata parser or cleaner and for malformed input boundaries. PNG fixtures must contain valid CRC values unless a test intentionally corrupts them.
5. Preserve the global, cross-format MS file-numbering system. Only the next safe integer may be stored under `meta-stripper.nextSequence`; never store a source filename, file, metadata report, or result.
6. Preserve the distinction between removable file metadata, required structural JPEG/PNG data, and information expressed in image pixels. Preserve PNG transparency and reject animated PNG cleaning rather than flattening it.
7. JPEG/JPG and static PNG are the permanent and complete supported image formats. No other image formats are planned. Do not add another format, format-specific architecture, or related dependency without an explicit instruction.
8. Keep batch defaults central: at most 20 queued source files, 200 MB combined source bytes, and one cleaning operation at a time. Inspect items independently, preserve selection order and duplicate items, stop batches only after the active item finishes, and never discard valid neighbors because another item fails.
9. Keep previews, sources, cleaned results, and ZIPs in browser memory only. Revoke object URLs when their resources are removed, cleared, superseded, downloaded, or abandoned on unmount.
10. ZIP downloads must be generated locally and on demand with bundled `fflate` store mode. Include only exact verified MS filenames and bytes, use a fixed 1980-01-01 timestamp, and include no source names, paths, comments, folders, manifests, logs, reports, or failed items. ZIP operations never change numbering.
11. Run `npm test`, `npm run lint`, and `npm run build`, and fix failures before reporting completion.
12. Never deploy, commit, push, pull, open a pull request, or otherwise publish changes unless the user explicitly requests it.
