"use client";

import { useEffect, useRef, useState } from "react";

import { useLocalDb } from "@/lib/local-db/provider";
import { useVault } from "@/lib/local-db/vault";
import { decodePortableData, replaceProfileData } from "@/lib/portable-data";
import { decryptTransferPayload } from "@/lib/share-transfer";

export default function TransferReceiver() {
  const { activeProfile, dataChanged } = useVault();
  const { db } = useLocalDb();
  const [message, setMessage] = useState("Preparing secure transfer…");
  const started = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("transfer");
    const secret = window.location.hash.slice(1);
    if (!id || !secret || !db || !activeProfile || started.current) return;

    started.current = true;
    void (async () => {
      const response = await fetch("/api/share/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download", id, code: id.slice(0, 6).toUpperCase() }),
      });
      const result = await response.json();
      if (!response.ok || !result.ready) {
        throw new Error("The other device is still preparing the transfer. Keep this page open and try again.");
      }
      const portable = decodePortableData(await decryptTransferPayload(result.payload, result.nonce, secret));
      const accepted = window.confirm(
        `Receive ${portable.records.length} records and replace this profile's financial data? Your local PIN/password will remain unchanged.`,
      );
      if (!accepted) {
        setMessage("Transfer cancelled. Your existing data was not changed.");
        return;
      }
      await replaceProfileData(db, activeProfile.id, portable);
      dataChanged();
      setMessage("Transfer complete. Your data has been restored on this device.");
      window.history.replaceState({}, "", "/dashboard");
    })().catch((cause) => {
      setMessage(cause instanceof Error ? cause.message : "Couldn't receive the shared data.");
    });
  }, [activeProfile, db, dataChanged]);

  return (
    <section className="mx-auto w-full max-w-md space-y-3 rounded-3xl bg-card p-6 text-center shadow-card ring-1 ring-foreground/6">
      <h1 className="text-xl font-semibold">Receive your budget</h1>
      <p className="text-sm/relaxed text-muted-foreground">{message}</p>
    </section>
  );
}
