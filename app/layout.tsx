import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://coachfort.com"),
  title: "CoachFort | Coaching Business Platform",
  description:
    "Manage students, courses, cohorts, payments, certificates, reminders, and WhatsApp-ready workflows from one platform.",
  icons: {
    apple: "/brand/coachfort-master.png",
    icon: "/brand/coachfort-master.png",
    shortcut: "/brand/coachfort-master.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-white font-sans text-zinc-950">
        {children}
      </body>
    </html>
  );
}
