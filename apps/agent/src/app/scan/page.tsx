import Link from "next/link";
import { Button } from "@koolee/ui";

import { CameraCapture } from "@/components/camera-capture";

export const metadata = { title: "Scan" };

export default function ScanPage() {
  return (
    <main className="container flex max-w-md flex-col gap-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Scan</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">Back</Link>
        </Button>
      </header>

      <CameraCapture />
    </main>
  );
}
