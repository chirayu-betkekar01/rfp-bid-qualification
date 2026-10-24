"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string; count?: number; hint: string };

/** The RFP's sections: a column on the left on wide screens, tabs across the top on narrow ones. */
export function RfpNav({ rfpId, title, buyer, lineItems, contributors }: {
  rfpId: number; title: string; buyer: string; lineItems: number; contributors: number;
}) {
  const pathname = usePathname();
  const base = `/rfps/${rfpId}`;
  const tabs: Tab[] = [
    { href: base, label: "Overview", hint: "Details, status and answers so far" },
    { href: `${base}/items`, label: "Line items", count: lineItems, hint: "Fix, route and answer" },
    { href: `${base}/contributors`, label: "Contributors", count: contributors, hint: "Who can be given items" },
  ];
  const isActive = (href: string) => (href === base ? pathname === base : pathname.startsWith(href));

  return (
    <nav aria-label="RFP sections"
         className="border-b border-zinc-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="hidden px-4 pt-5 pb-3 lg:block">
        <Link href="/" className="text-xs text-zinc-500 hover:underline">← All RFPs</Link>
        <p className="mt-2 line-clamp-3 text-sm font-semibold leading-snug">{title}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{buyer}</p>
      </div>
      <ul className="flex gap-1 overflow-x-auto px-2 py-2 lg:flex-col lg:px-2 lg:py-1">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <li key={tab.href} className="shrink-0">
              <Link href={tab.href} aria-current={active ? "page" : undefined}
                    className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ${active
                      ? "bg-indigo-50 font-medium text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200"
                      : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
                <span>
                  {tab.label}
                  <span className="hidden text-xs font-normal text-zinc-500 lg:block">{tab.hint}</span>
                </span>
                {tab.count !== undefined && (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {tab.count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
