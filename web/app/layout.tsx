import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";

import { signOut } from "@/app/actions";
import { Avatar } from "@/components/assign-dialog";
import { MANAGER_ROLE } from "@/lib/people";
import { getActor } from "@/lib/reviewer";
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
              <SignedIn />
            </Suspense>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}

/** Who is signed in; their name goes on every change they make. */
async function SignedIn() {
  const actor = await getActor();
  if (!actor) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {actor.role !== MANAGER_ROLE && (
        <Link href={`/r/${actor.linkToken}`} className="text-indigo-600 hover:underline dark:text-indigo-400">My line items</Link>
      )}
      <span className="flex items-center gap-2">
        <Avatar name={actor.name} />
        <span className="font-medium">{actor.name}</span>
        <span className="text-zinc-500">· {actor.role}</span>
      </span>
      <form action={signOut}>
        <button className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Sign out
        </button>
      </form>
    </div>
  );
}
