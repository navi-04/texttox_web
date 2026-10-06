import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://texttox.fewinfos.com"),
  title: "Text to X",
  description: "Chat anonymously: one-to-one, with a random stranger, or in a public room.",
  applicationName: "Text to X",
  // Added to a phone's home screen it opens full screen, like an app.
  appleWebApp: { capable: true, title: "Text to X", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // use the whole screen, including behind the notch; the CSS adds the safe-area padding
  interactiveWidget: "resizes-content", // when the keyboard opens the page shrinks above it, so the message box stays visible
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
