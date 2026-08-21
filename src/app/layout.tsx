import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Keyword CPC",
  description: "Bulk keyword CPC and volume research via the Google Ads Keyword Planner API",
};

/**
 * Sets data-theme before first paint so there is no flash of the wrong theme
 * (§5). localStorage wins; otherwise follow the OS preference.
 */
const THEME_SCRIPT = `
try {
  var t = localStorage.getItem('theme');
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', t);
} catch (e) {
  document.documentElement.setAttribute('data-theme', 'light');
}
`.trim();

/**
 * `suppressHydrationWarning` on <html> is required, not cosmetic: THEME_SCRIPT
 * rewrites data-theme before React hydrates, so the server's "light" and the
 * client's actual value legitimately differ. Without it, React logs a hydration
 * mismatch on every dark-theme load. It applies to this element's own
 * attributes only, not to its subtree.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${inter.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
