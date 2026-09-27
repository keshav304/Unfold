# Crosslinked Fixture

Three H2 sections, each linking to exactly one other section — three internal
cross-links across three distinct H2 sections. There is no `graph` block
anywhere in this file: the derived-document-map thresholds in spec §6.7 are
what turn the graph capability on. This fixture sits exactly on that boundary.
Two links would leave the capability off.

## Ingest

Documents arrive through the loader described in
[Storage](#storage). The loader is deliberately boring.

## Storage

Parsed documents are kept next to their source. What happens to them afterwards
is covered by [Presentation](#presentation).

## Presentation

Only the reader consumes the stored form. The origin is described in
[Ingest](#ingest); the rest of this section is filler prose so that it carries
a realistic amount of text without adding any further links.
