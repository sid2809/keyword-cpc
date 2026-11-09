import type { Metadata } from "next";
import "./globals.css";
import { fontClassNames } from "./fonts";
import { ThemeSync } from "@/components/theme-sync";
import { Toaster } from "@/components/toast";

export const metadata: Metadata = {
  title: "Keyword CPC",
  description: "Bulk keyword CPC and volume research via the Google Ads Keyword Planner API",
};

/**
 * Sets data-theme before first paint so there is no flash of the wrong theme
 * (§5). localStorage wins; otherwise follow the OS preference.
 *
 * Also sets data-sidebar the same way, so the sidebar opens at its remembered
 * width with no jump: collapsed (icons only) unless the user expanded it.
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
try {
  document.documentElement.setAttribute(
    'data-sidebar',
    localStorage.getItem('sidebar') === 'expanded' ? 'expanded' : 'collapsed'
  );
} catch (e) {
  document.documentElement.setAttribute('data-sidebar', 'collapsed');
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
      data-sidebar="collapsed"
      suppressHydrationWarning
      className={`${fontClassNames} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeSync />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
