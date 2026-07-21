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

const title = "CoachFort | Branded Online Coaching Platform";
const description =
  "CoachFort helps coaches create CoachFort-hosted branded program pages, collect enrollment requests, manage student access, deliver live classes and materials, and track invoices, manual payments, and receipts under their own brand.";

export const metadata: Metadata = {
  metadataBase: new URL("https://coachfort.com"),
  title,
  description,
  alternates: {
    canonical: "/",
  },
  icons: {
    apple: "/brand/coachfort-favicon.png",
    icon: "/brand/coachfort-favicon.png",
    shortcut: "/brand/coachfort-favicon.png",
  },
  openGraph: {
    description,
    images: ["/brand/coachfort-master.png"],
    siteName: "CoachFort",
    title,
    type: "website",
    url: "https://coachfort.com",
  },
  twitter: {
    card: "summary_large_image",
    description,
    images: ["/brand/coachfort-master.png"],
    title,
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
