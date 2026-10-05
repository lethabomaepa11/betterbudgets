import TransferReceiver from "@/components/transfer-receiver";
import VaultGate from "@/components/vault/gate";

export default function TransferPage() {
  return (
    <VaultGate>
      <TransferReceiver />
    </VaultGate>
  );
}
