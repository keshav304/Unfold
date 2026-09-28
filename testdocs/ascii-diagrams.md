---
title: ASCII Diagram Fixtures
description: Six fences that exercise the ASCII diagram parser — four that must parse, two that must not.
---

Every fence below is an untagged one, so §6.9 classifies each of them as a
terminal candidate, and the reader is where the ASCII diagram parser gets its
say. Four of the six are diagrams and must render as SVG. The last two are not,
and must keep the existing terminal window: a fence that merely *looks* like a
diagram is not one, and the parser is built to refuse rather than guess.

## Fixture A — vertical flow

Boxes joined by horizontal arrows with labels written beside them, and a pair of
vertical drops. `---->` runs left to right, `<----` runs right to left.

```
+-------------+   request   +--------------+
| Browser     | ----------> | Dev server   |
+-------------+   client    +--------------+
       |                          |
       | fetch                    |
       v                          v
+-------------+   query     +--------------+
| API         | <---------- | PostgreSQL   |
+-------------+             +--------------+
```

## Fixture B — Unicode boxes

The same flow drawn with box-drawing characters. `┌ ┐ └ ┘` are corners, `─` is a
horizontal, `│` a vertical, and `▶ ▼ ◀` are arrowheads. The parser normalises
these into the same roles as the ASCII characters and keeps the coordinates, so
this fence must produce the same diagram as Fixture A.

```
┌─────────────┐   request   ┌──────────────┐
│ Browser     │ ──────────▶ │ Dev server   │
└─────────────┘   client    └──────────────┘
       │                          │
       │ fetch                    │
       ▼                          ▼
┌─────────────┐   query     ┌──────────────┐
│ API         │ ◀────────── │ PostgreSQL   │
└─────────────┘             └──────────────┘
```

## Fixture C — interior junctions

Two boxes. The upper box's bottom border carries an interior `+` that is a
connector attachment point, not a corner, and the lower box has an internal
divider — a shape that is one box with a wall in it, not three boxes. A connector
exits from the interior junction of the upper box and lands on the lower box.

```
+-----------+-----------+
|                       |
|        Router         |
+-----------+-----------+
            |
            |
            v
+-----------+-----------+
|     Proxy |  Cache    |
+-----------+-----------+
```

## Fixture D — vertical arrow

A single vertical connector whose direction comes from its `v` arrowhead, with a
label on the middle row.

```
+---------------+
|    Ingest     |
+---------------+
        |
        | buffer
        v
+---------------+
|    Publish    |
+---------------+
```

## Fixture E — hostile prose

Prose that contains `+`, `|`, `<` and `>` and no diagram at all. Detection still
classifies it as a terminal candidate, which is the point: the parser is the
second line of defence, and it must return `unparseable` rather than promote a
sentence into a picture.

```
Run `logs | grep -v debug` and then diff the two files:

  left.txt  -->  right.txt
  alpha <-- beta

Costs are 3 < 4 and 5 > 2, and a pipe | is not a diagram.
```

## Fixture F — dangling arrow

Two boxes, and two arrows that reach nothing: one points off the left edge of the
drawing, the other off into the space between the boxes and past them. The
dangling connectors must be dropped, and because what remains has no box-to-box
edge, the whole fence must be `unparseable`. The parser must not invent a
destination, and must not infer an edge merely because two boxes are near each
other.

```
   <-----

+-------------+          +-------------+
|   Producer  |          |   Consumer  |
+-------------+          +-------------+
                        ------->
```
