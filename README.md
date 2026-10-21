# Meta Stripper

Meta Stripper is a personal, privacy-first JPEG and static PNG metadata cleaner. It inspects removable file-level metadata, explains what it finds, cleans and verifies each result locally, and gives it a persistent `MS` filename such as `MS1.jpg` or `MS2.png`.

## Privacy model

All inspection and processing happens in the browser. The app has no API routes, server actions, accounts, analytics, databases, remote fonts, processing services, or runtime network dependency. It never stores images, source filenames, reports, or output files in browser storage. `localStorage` holds only the next global sequence number.

Meta Stripper removes removable file-level metadata. It does not remove visible watermarks, does not guarantee removal of pixel-level or imperceptible watermarks, and does not override disclosure requirements imposed by any platform.

## Current features

- `.jpg` and `.jpeg` input with extension, signature, size, decode, and pixel-dimension validation
- Bounds-checked JPEG marker inspection for EXIF, XMP, ICC, JUMBF/C2PA, Photoshop/IPTC, comments, and other non-structural APP blocks
- Adaptive JPEG cleaning: safe metadata is removed without recompressing the scan, while orientation or ICC colour handling uses a high-quality canvas rebuild
- Post-clean metadata verification, with already-clean files left unnumbered until download
- `.png` input with full signature, chunk-order, length, CRC, dimension, critical-chunk, and end-marker validation
- PNG inspection for eXIf, text, XMP, ICC, timestamps, pixel density, C2PA, signatures, and unknown ancillary chunks
- Adaptive static PNG cleaning: safe metadata-only files are stripped without decoding or recompressing IDAT, while orientation- or colour-sensitive files use a transparent-canvas rebuild
- PNG output, dimensions, and transparency are retained without JPEG-style lossy compression
- Animated PNG detection and safe cleaning refusal, preventing accidental animation flattening
- Post-encode metadata stripping and mandatory verification for both formats
- One persistent global sequence across formats (`MS1.jpg`, `MS2.png`, …) with an in-memory fallback
- A local queue for one or several selections, capped centrally at 20 files, 200 MB of source data, and 512 MB of estimated decoded pixels
- Per-file inspection, status, retry, removal, cleaning, verification, and individual download controls
- Sequential **Clean all ready** processing with stop-after-current behavior and completion-order MS numbering
- Store-mode ZIP download for two or more verified results, containing only exact assigned MS filenames
- Drag and drop, file picker, responsive layouts, keyboard focus, and screen-reader status announcements

For direct PNG stripping, the signature and all retained chunks—including IDAT, PLTE, and tRNS—are copied byte-for-byte, so removing metadata cannot increase the file size. eXIf, iCCP, presentation-sensitive ancillary chunks, and uncertain unsafe-to-copy chunks conservatively use the canvas fallback. Browser PNG rendering in that fallback may normalise colour values, so canvas rebuilding is not described as byte-for-byte lossless.

JPEG/JPG and static PNG are the supported image formats. MP4 and MOV metadata is removed from the container without recompressing the frames. Animated PNG remains unsupported and is never flattened. A SynthID watermark woven into frames is not metadata and is not removed.

## Offline install

A hand-written service worker, generated at build time, precaches only the built app shell: the document, its JavaScript and CSS, the manifest, and the install icons. Cache Storage never receives an image, a metadata report, or a source filename. Desktop Chrome and Android Chrome can install that shell. After the first online visit, the app opens and cleans files already on the device with no network. iOS is not part of this install path.

## Hosting headers

`vercel.json` sends a strict Content Security Policy, `nosniff`, `no-referrer`, frame denial, a locked-down permissions policy, and HSTS for the production host. The policy allows same-origin scripts and styles, plus `blob:` image previews for local results. It does not allow inline scripts, eval, remote fonts, analytics, or file transmission. Local preview omits HSTS and `upgrade-insecure-requests` so `http://127.0.0.1` still loads.

## Local batch and ZIP behavior

Selections keep their original order, and files with duplicate source names remain distinct queue items. An invalid or unsupported item does not discard valid neighbors. Cleaning concurrency is fixed at one so canvas work stays predictable; batch failures remain attached to their item and do not stop later ready files. A stop request lets the active item finish safely and leaves the rest ready.

MS numbers are assigned only after a cleaner has produced and verified a successful result. Failures, retries, stopping, removals, clearing the queue, and ZIP generation do not consume a number. Removing a verified result does not make its number reusable.

ZIP archives are created in memory with the bundled `fflate` dependency. Entries use store mode (`level: 0`) because JPEG and PNG data is already compressed, avoiding wasteful recompression and keeping the implementation small and auditable. Each entry contains only its verified `MS<number>.jpg` or `MS<number>.png` name and exact cleaned bytes, with a fixed 1980-01-01 timestamp and no source names, directories, comments, manifest, report, or log. Repeated generation from the same ordered results is deterministic. Temporary preview, result, and archive object URLs are revoked when superseded, removed, cleared, downloaded, or when the app unmounts.

Compared with the Phase 2.1 production baseline, the complete Phase 3 queue and ZIP implementation increases the main minified JavaScript bundle by 17.10 kB (6.64 kB gzip). This measured delta includes both the queue UI/orchestration and `fflate`; no runtime network dependency is introduced.

## Development

Requires a current Node.js release and npm.

```sh
npm install
npm run dev
```

Quality checks:

```sh
npm test
npm run lint
npm run build
npm run test:e2e
```

The Vite output is a client-only static site in `dist/`, including `sw.js`. `vercel.json` is the hosting configuration. A preview deploy comes before production.

See [PROJECT_SPEC.md](./PROJECT_SPEC.md) for product invariants and the permanent format boundary.
