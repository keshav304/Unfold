# Edge Cases

Everything in this file is legal markdown that a naive parser mishandles, plus
a few blocks that are not legal at all. Nothing here may throw.

## Duplicate headings

This heading is repeated on purpose.

## Duplicate headings

The second occurrence must receive the `-1` suffix, so deep links to the first
one keep working. This sentence also links to [the first copy](#duplicate-headings)
and to a target that does not exist: [nowhere](#no-such-section).

## Self reference

A section may link to itself; derivation ignores such links.
[Back to this section](#self-reference)

## Unicode headings

### 中文标题

Chinese text in a heading must survive slugging: letters are Unicode letters.

### Пример

Cyrillic likewise.

### 🚀 Launch

The leading emoji is dropped, which leaves a leading hyphen.

## Raw HTML in markdown

<details>
  <summary>Click me</summary>

  Hidden prose with a <br> tag in it.

</details>

A <span class="inline">inline element</span> inside a paragraph stays part of
the paragraph's text.

## Empty table

| Column | Meaning |
| --- | --- |

No data rows at all. The table must still classify as a table.

## Nested code fences

````text
A four-backtick fence containing a three-backtick fence:

```python
def inner():
    return "this is a string, not an entity"
```

The outer fence ends here.
````

## Malformed blocks

A `graph` block with no node declarations:

```graph
edges:
  a -> b
```

A `steps` block whose lines are not numbered:

```steps
First, we do a thing.
Then another thing happens.
```

A `loop` block with nothing in it:

```loop
```

None of the three above may throw. Each degrades to a plain code block with a
development-mode warning.

## Prose with entities

Two file paths, deliberately fewer than the threshold for the entity
capability: src/pipeline/slug.ts and tools/lint.py, plus one symbol reference
src/pipeline/slug.ts::slugify.
