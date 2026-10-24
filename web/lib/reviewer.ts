import { cookies } from "next/headers";

// There is no login yet: the reviewer names themselves, and the name is stored with every change.
export const REVIEWER_COOKIE = "reviewer";

export async function getReviewer(): Promise<string> {
  return (await cookies()).get(REVIEWER_COOKIE)?.value ?? "";
}
