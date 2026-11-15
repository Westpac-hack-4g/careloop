import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CareLoop prototype",
  description: "Hackathon prototype. Sample data only. Not a Westpac product.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-brand="wbc" data-theme="light">
      <body className="antialiased">{children}</body>
    </html>
  );
}
