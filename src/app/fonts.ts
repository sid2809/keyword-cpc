import localFont from "next/font/local";

/**
 * The app's font: the one place fonts are configured.
 *
 * The font files live in the repo (./fonts/inter), so `next build` never
 * downloads anything from Google. Inter 4.001, variable weight 100–900, from
 * @fontsource-variable/inter 5.3.0. Licence: SIL OFL 1.1 (./fonts/inter/LICENSE.txt).
 *
 * The rest of the app only uses the CSS variable `--font-primary`
 * (see globals.css). Nothing else refers to Inter by name.
 *
 * One localFont() call per character set, each with its own unicode-range,
 * so browsers download only the sets a page actually needs (same behaviour
 * as Google Fonts). All calls declare the same font-family, `fontPrimary`,
 * which must equal the name of the first constant: Next.js names the family
 * behind `--font-primary` after that constant.
 *
 * Only `fontPrimary` (Latin) is preloaded and generates the size-matched
 * fallback font, as with the previous Google setup (subsets: ["latin"]).
 *
 * To change the font: replace the files in ./fonts, then update `src`, the
 * `weight` range and the unicode-ranges below. Next.js requires every option
 * here to be a written-out literal, so the values cannot come from variables.
 */

export const fontPrimary = localFont({
  src: "./fonts/inter/inter-latin-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-primary",
  declarations: [
    { prop: "font-family", value: "fontPrimary" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const fontPrimaryLatinExt = localFont({
  src: "./fonts/inter/inter-latin-ext-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-primary-latin-ext",
  declarations: [
    { prop: "font-family", value: "fontPrimary" },
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});

const fontPrimaryCyrillic = localFont({
  src: "./fonts/inter/inter-cyrillic-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-primary-cyrillic",
  declarations: [
    { prop: "font-family", value: "fontPrimary" },
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

const fontPrimaryCyrillicExt = localFont({
  src: "./fonts/inter/inter-cyrillic-ext-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-primary-cyrillic-ext",
  declarations: [
    { prop: "font-family", value: "fontPrimary" },
    {
      prop: "unicode-range",
      value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
    },
  ],
});

const fontPrimaryGreek = localFont({
  src: "./fonts/inter/inter-greek-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-primary-greek",
  declarations: [
    { prop: "font-family", value: "fontPrimary" },
    {
      prop: "unicode-range",
      value: "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF",
    },
  ],
});

const fontPrimaryGreekExt = localFont({
  src: "./fonts/inter/inter-greek-ext-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-primary-greek-ext",
  declarations: [
    { prop: "font-family", value: "fontPrimary" },
    { prop: "unicode-range", value: "U+1F00-1FFF" },
  ],
});

const fontPrimaryVietnamese = localFont({
  src: "./fonts/inter/inter-vietnamese-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-primary-vietnamese",
  declarations: [
    { prop: "font-family", value: "fontPrimary" },
    {
      prop: "unicode-range",
      value:
        "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    },
  ],
});

/**
 * Class names to put on <html>. Applying every call keeps all seven
 * @font-face rules in the page's CSS; only `--font-primary` is used.
 */
export const fontClassNames = [
  fontPrimary,
  fontPrimaryLatinExt,
  fontPrimaryCyrillic,
  fontPrimaryCyrillicExt,
  fontPrimaryGreek,
  fontPrimaryGreekExt,
  fontPrimaryVietnamese,
]
  .map((font) => font.variable)
  .join(" ");
