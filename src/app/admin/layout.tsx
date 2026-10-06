import type { Viewport } from "next";
import "../globals.css";

// The admin page keeps its own look (globals.css); the public site has a separate stylesheet.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f11" },
  ],
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
