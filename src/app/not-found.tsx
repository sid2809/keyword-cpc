import Link from "next/link";
import { BTN_PRIMARY, Card, EmptyState } from "@/components/ui";

/** Friendly 404 — reached by notFound() on a missing or deleted run. */
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <EmptyState
          title="Not found"
          body="That page doesn't exist. If you were looking at a run, it may have been deleted."
          action={
            <Link href="/" className={BTN_PRIMARY}>
              New search
            </Link>
          }
        />
      </Card>
    </main>
  );
}
