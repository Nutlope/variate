# Inter, vendored

- File: `inter.woff2` is `InterVariable.woff2` (roman, variable weight 100-900)
  from the Inter v4.1 release: https://github.com/rsms/inter/releases/tag/v4.1
- License: SIL Open Font License 1.1, in `OFL.txt` beside this file. The card
  registers it under the private family name `variate-inter` (a CSS alias, not
  a rename), so the host page's own use of Inter is never affected.
- Served by the sidecar at `GET /inter.woff2` and loaded by the card through
  the FontFace API. It never touches the user's project.
- This is the full roman file (344 KB): it only ever serves from 127.0.0.1, so
  weight matters less than glyph coverage. If you ever subset it, keep the
  `tnum` layout feature (the card relies on tabular numerals) and the glyphs
  the card renders beyond ASCII: U+00B7 middle dot, U+2039/U+203A angle
  quotes, U+2190/U+2192 arrows, U+25BE down triangle. A known-good command:

  pyftsubset InterVariable.woff2 --flavor=woff2 \
    --layout-features='calt,ccmp,kern,tnum' \
    --unicodes='U+0020-007E,U+00A0-00FF,U+00B7,U+2018-2019,U+201C-201D,U+2022,U+2026,U+2039,U+203A,U+2190,U+2192,U+25BE' \
    --output-file=inter.woff2
