# cram-viewer

CRAM alignment summary viewer with container metadata, reference information, and file structure display.

## Features

- CRAM file definition header parsing (magic, version, file ID)
- Container header metadata display (length, reference info, record count)
- File version detection (CRAM 2.x / 3.x)
- Container listing with position and size information
- Reference-based compression info display
- Note: Full record decoding requires a reference genome; this viewer shows file structure and metadata

## Supported Extensions

- `.cram`

## Installation

Install from the **Plugins** tab in the AutoPipe desktop app.
