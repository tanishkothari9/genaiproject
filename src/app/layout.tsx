import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Research Synthesis Engine",
  description:
    "Query-driven paper discovery, claim extraction, cross-source synthesis, and traceable research briefs.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
