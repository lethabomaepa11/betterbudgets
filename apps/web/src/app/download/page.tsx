import { Download, ExternalLink, Smartphone } from "lucide-react";
import Link from "next/link";

import { Button } from "@betterbudgets/ui/components/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@betterbudgets/ui/components/card";
import { LogoLockup } from "@/components/logo";

const IOS_URL = process.env.NEXT_PUBLIC_IOS_APP_URL;
const ANDROID_URL = process.env.NEXT_PUBLIC_ANDROID_APP_URL;

export default function DownloadPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-8 py-8 text-center">
      <LogoLockup width={180} priority className="h-auto w-[180px]" />
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Take betterbudgets with you</h1>
        <p className="mt-2 text-muted-foreground">
          Use the mobile app for quick entries, account checks, and secure sync across your devices.
        </p>
      </div>

      <div className="grid w-full gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <Smartphone className="size-6 text-primary" aria-hidden="true" />
            <CardTitle>iPhone and iPad</CardTitle>
            <CardDescription>
              Download the official iOS app when it is available in your region.
            </CardDescription>
            <Button className="mt-2" disabled={!IOS_URL} render={IOS_URL ? <a href={IOS_URL} target="_blank" rel="noreferrer" /> : undefined}>
              <Download data-icon="inline-start" /> App Store
            </Button>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <Smartphone className="size-6 text-primary" aria-hidden="true" />
            <CardTitle>Android</CardTitle>
            <CardDescription>
              Download the official Android app when it is available in your region.
            </CardDescription>
            <Button className="mt-2" disabled={!ANDROID_URL} render={ANDROID_URL ? <a href={ANDROID_URL} target="_blank" rel="noreferrer" /> : undefined}>
              <Download data-icon="inline-start" /> Google Play
            </Button>
          </CardHeader>
        </Card>
      </div>

      {!IOS_URL && !ANDROID_URL && (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Store links will appear here once the mobile release is published.
        </p>
      )}
      <Button variant="outline" render={<Link href="/dashboard" />}>
        <ExternalLink data-icon="inline-start" /> Continue in browser
      </Button>
    </div>
  );
}
