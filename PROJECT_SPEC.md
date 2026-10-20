# Meta Stripper — Project Specification

## Product

Meta Stripper is a personal, privacy-first image metadata cleaning tool. It inspects supported image files, explains removable metadata categories, cleans them locally with the format's safe strategy, verifies the result, and prepares a safely renamed download.

The application is browser-only. Image processing must remain on the user's device, with no uploads, telemetry, remote processing, API route, server action, database, or account system. **User files must never be uploaded.**

## Permanent format support

- Phase 1: JPEG (`.jpg` and `.jpeg`).
- Phase 2: static PNG (`.png`) with transparency preservation. Animated PNG is detected but excluded because rebuilding would flatten or damage animation.

JPEG/JPG and static PNG are the product's permanent supported image formats. No other image formats are planned. No additional format architecture or dependency should be introduced unless an explicit instruction changes this boundary.

## Metadata and image structure

Removable metadata is file-level information carried in JPEG APP/COM segments or PNG ancillary chunks. It may describe a camera or capture, creator, edit history, colour profile, provenance assertion, publishing details, pixel density, modification time, digital signature, or free text.

Structural image data is different. Markers and scan data needed to decode the JPEG are not reported as private metadata and must not be removed from an encoded file. Structural examples include quantisation and Huffman tables, frame and scan headers, restart markers, JFIF compatibility data, and compressed scan bytes.

Required PNG structure is also not metadata. It includes the PNG signature, IHDR, image data in IDAT, IEND, palettes where required, and transparency or standard colour-rendering chunks needed for consistent display. Unknown critical PNG chunks are rejected rather than removed speculatively. Removable PNG categories include eXIf, original tEXt/zTXt/iTXt and XMP, iCCP after browser colour normalisation, tIME, pHYs, caBX, dSIG, and unknown nonessential ancillary chunks.

File-level metadata is also different from information expressed in image pixels. Meta Stripper does not remove visible watermarks and does not guarantee removal of pixel-level or imperceptible watermarks. “Verified clean” covers file-level metadata detected by Meta Stripper and does not guarantee how external platforms classify an image. It does not override disclosure requirements imposed by any platform. The product must never be positioned as an AI-label remover or detection bypass tool.

## Persistent MS numbering

Every successfully cleaned and verified output uses one global sequence across JPEG and PNG: `MS1.jpg`, `MS2.png`, `MS3.jpg`, and so on. Counters are never split by format.

Only the next number is stored under `meta-stripper.nextSequence` in `localStorage`. The initial and recovery value is 1. Missing, invalid, negative, zero, non-integer, and unsafe values reset to 1. If browser storage is unavailable, an in-memory counter is used with a clear persistence warning.

Inspection, upload, cancellation, rejection, and failure never consume a number. The counter advances only after cleaning and verification succeed. Repeated downloads of one result retain its assigned name. Resetting requires confirmation, is unavailable while cleaning, changes only the next number to 1, and never alters previously downloaded files.

No original filename, file content, metadata report, or output is stored in `localStorage`, IndexedDB, cookies, or remotely.

## Processing requirements

JPEG parsing uses `ArrayBuffer`/`Uint8Array`, validates the start-of-image signature, performs strict segment bounds checks, and stops metadata traversal when compressed scan data begins. Malformed input must fail in a controlled way.

Deep Clean decodes locally with orientation applied, draws the displayed image into a local canvas, and re-encodes at JPEG quality 0.98. The encoded result is stripped of removable APP and COM segments, rescanned, and rejected if any removable block remains. Rebuilding JPEG pixels is not lossless and can change compression and file size.

Static PNG Deep Clean validates every chunk and CRC, refuses APNG files carrying `acTL`, and selects one of two internal strategies:

- **Direct strip:** When all removable chunks are proven safe to delete without changing display, the PNG signature and retained chunks are copied byte-for-byte. IDAT is never decoded or recompressed. PLTE, tRNS, required structure, and standard colour-rendering chunks remain unchanged. Text/XMP, tIME, pHYs, caBX, dSIG, and safe nonessential ancillary chunks can use this path. The verified result cannot be larger than the source.
- **Canvas rebuild:** eXIf, iCCP, known presentation-sensitive ancillary chunks, unknown unsafe-to-copy chunks, and any uncertain case use local decoding with supported orientation applied. Pixels are drawn into a transparent canvas and re-encoded as PNG, then a conservative chunk allowlist removes metadata. Browser rendering may normalise colour values, so this fallback is not byte-for-byte lossless.

Both strategies reparse the final output and reject it if removable metadata remains. Animated PNG is rejected before strategy execution and is never flattened.

## Local batch workflow

The same input accepts single or multiple selection and drag-and-drop. Limits are centrally configured at 20 queued files and 200 MB of combined source bytes. New selections are appended in their browser-provided order. Duplicate source names are allowed and use separate internal identities. Every item owns its source reference, format, dimensions, inspection report, cleaning strategy, status, failure stage, verified result, and assigned output name.

Inspection and validation are isolated per item: a malformed file or animated PNG does not discard valid neighbors. Queue states include inspecting, ready, cleaning, verified, unsupported, and failed. Inspection and cleaning failures expose a retry for the failed stage. Items may be removed individually, or the queue may be cleared, when no operation is active. Assigned sequence numbers are never reclaimed.

**Clean all ready** processes a stable snapshot of ready items sequentially with concurrency fixed at one. Later items continue after a per-file failure. A stop request never interrupts a file partway through cleaning or verification: the current item completes, then untouched items remain ready. Conflicting add, clean, retry, remove, clear, reset, and ZIP actions are disabled or guarded while an operation is active. Progress, per-file transitions, summaries, and completion or failure announcements are exposed accessibly.

Temporary source previews and verified results remain in memory. Their object URLs are revoked after replacement, removal, clear, or unmount. The application persists no queue or image data.

## Local ZIP export

Two or more verified results may be downloaded together as `Meta-Stripper-MS<lowest>-to-MS<highest>.zip`. ZIP creation is entirely local and includes only exact verified output filenames and cleaned bytes. The bundled `fflate` library writes store-mode entries (`level: 0`), since JPEG and PNG payloads are already compressed; this avoids pointless media recompression and adds no runtime network requirement. Entries have a fixed local timestamp of 1980-01-01 and contain no source filename, directory, comment, manifest, metadata report, or log. Given the same ordered verified inputs, archive bytes are stable. ZIP generation never assigns or changes an MS number, and its temporary object URL is revoked after download. The measured Phase 3 main-JavaScript increase over the Phase 2.1 production baseline is 17.10 kB minified (6.64 kB gzip), including both queue orchestration and `fflate`.

## Development phases

1. Project foundation and complete JPEG workflow. Complete.
2. Static PNG inspection, adaptive direct-strip/canvas cleaning, transparency preservation, verification, APNG refusal, and the shared MS sequence. Complete.
3. Local queue, sequential batch cleaning, accessible progress and recovery, deterministic in-memory ZIP export, and resource cleanup. Complete.

JPEG/JPG and static PNG remain the complete format boundary. No additional format support, abstraction, or dependency belongs in the project unless explicitly instructed.
