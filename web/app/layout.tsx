import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";

import { ReviewerName } from "@/components/reviewer-name";
import { getReviewer } from "@/lib/reviewer";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Tallyhouse RFP Review",
  description: "AI drafts; people decide. Review and confirm every RFP requirement before drafting.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Tallyhouse <span className="font-normal text-zinc-500">RFP Review</span>
            </Link>
            <Suspense fallback={null}>
              <Reviewer />
            </Suspense>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}

async function Reviewer() {
  return <ReviewerName initial={await getReviewer()} />;
}
