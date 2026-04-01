import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SonnerToaster } from "@/components/ui/sonner-toaster";
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
  title: "Vibe Pipeline Dashboard",
  description: "Project management dashboard for intake and pipeline sessions."
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
      <body className="min-h-full bg-background text-foreground">
        <SonnerToaster />
        <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-6 py-8 md:px-10">
          <header className="mb-8 flex items-center justify-between border-b border-border pb-4">
            <div>
              <p className="text-sm text-muted-foreground">Vibe Pipeline</p>
              <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            </div>
          </header>
          <main className="flex flex-1 flex-col">{children}</main>
        </div>
      </body>
    </html>
  );
}
