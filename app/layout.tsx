import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "CivicLens · A better city starts with you",
  description:
    "Report, track and resolve civic issues in Chennai. English and Tamil citizen intake with a simulated authority network.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
