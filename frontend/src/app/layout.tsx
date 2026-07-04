import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Recall — AI Study Assistant",
  description:
    "Upload your notes and textbooks, then ask questions and get citation-backed answers. Powered by a Retrieval-Augmented Generation (RAG) pipeline.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full antialiased">
        <div className="aurora" />
        <div className="relative z-10 min-h-screen">{children}</div>
      </body>
    </html>
  );
}
