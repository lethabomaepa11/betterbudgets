import { Ionicons } from "@expo/vector-icons";
import { Button, Card, Input, Label, TextField } from "heroui-native";
import { useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";

import { addTransaction, loadBudget, type Account, type Plan, type Transaction } from "@/lib/budget-db";
import { syncBudget } from "@/lib/budget-api";

const money = (value: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

export function DashboardScreen() {
  const [data, setData] = useState<{ accounts: Account[]; transactions: Transaction[]; plans: Plan[] }>();
  const [error, setError] = useState<string>();
  const [syncing, setSyncing] = useState(false);
  const refresh = async () => {
    setError(undefined);
    try {
      setData(await loadBudget());
    } catch {
      setError("Could not open your local budget.");
    }
  };
  useEffect(() => void refresh(), []);
  const total = useMemo(() => data?.accounts.reduce((sum, account) => sum + account.balance, 0) ?? 0, [data]);
  const monthNet = useMemo(
    () => data?.transactions.reduce((sum, row) => sum + (row.type === "income" ? row.amount : -row.amount), 0) ?? 0,
    [data],
  );
  const runSync = async () => {
    setSyncing(true);
    try {
      const result = await syncBudget();
      setError(`Synced ${result.pushed} changes and received ${result.pulled} updates.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sync failed. Your local data is safe.");
    } finally {
      setSyncing(false);
    }
  };
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" refreshControl={<RefreshControl refreshing={!data} onRefresh={refresh} />} contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text className="text-3xl font-semibold text-foreground">Your budget</Text>
      <Text className="text-muted">A calm view of what is available and what is coming up.</Text>
      <Card className="gap-2 p-5">
        <Text className="text-muted">Total balance</Text>
        <Text selectable className="text-4xl font-semibold text-foreground">{money(total)}</Text>
        <Text className={monthNet >= 0 ? "text-success" : "text-danger"}>{money(monthNet)} net activity</Text>
      </Card>
      {error ? <Text selectable className="text-muted">{error}</Text> : null}
      <View className="flex-row gap-3">
        <Card className="flex-1 gap-1 p-4"><Text className="text-muted">Accounts</Text><Text className="text-2xl font-semibold text-foreground">{data?.accounts.length ?? "—"}</Text></Card>
        <Card className="flex-1 gap-1 p-4"><Text className="text-muted">Recurring</Text><Text className="text-2xl font-semibold text-foreground">{data?.plans.length ?? "—"}</Text></Card>
      </View>
      <Button variant="secondary" onPress={runSync} isDisabled={syncing}><Button.Label>{syncing ? "Syncing…" : "Sync with your account"}</Button.Label></Button>
    </ScrollView>
  );
}

export function TransactionsScreen() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string>();
  const load = async () => { const next = await loadBudget(); setRows(next.transactions); setAccounts(next.accounts); };
  useEffect(() => void load(), []);
  const add = async () => {
    const value = Number(amount);
    if (!merchant.trim() || !Number.isFinite(value) || value <= 0) { setError("Enter a merchant and a positive amount."); return; }
    if (!accounts[0]) { setError("Add an account on the web app before logging a transaction."); return; }
    try { await addTransaction({ accountId: accounts[0].id, merchant: merchant.trim(), amount: value, type: "expense", date: new Date().toISOString() }); setMerchant(""); setAmount(""); setError(undefined); await load(); }
    catch { setError("Could not save this transaction. Try again."); }
  };
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text className="text-3xl font-semibold text-foreground">Transactions</Text>
      <Text className="text-muted">Log spending locally, then sync it when you are signed in.</Text>
      <Card className="gap-3 p-4">
        <TextField><Label>Merchant</Label><Input value={merchant} onChangeText={setMerchant} placeholder="Coffee shop" /></TextField>
        <TextField><Label>Amount</Label><Input value={amount} onChangeText={setAmount} placeholder="12.50" keyboardType="decimal-pad" /></TextField>
        <Button onPress={add}><Button.Label>Add expense</Button.Label></Button>
        {error ? <Text selectable className="text-danger">{error}</Text> : null}
      </Card>
      {rows.length === 0 ? <Card className="items-center gap-2 p-8"><Ionicons name="receipt-outline" size={28} color="#8E8E93" /><Text className="text-muted">No transactions yet.</Text></Card> : rows.map((row) => <Card key={row.id} className="flex-row items-center justify-between p-4"><View><Text className="font-medium text-foreground">{row.merchant}</Text><Text className="text-muted">{new Date(row.date).toLocaleDateString()}</Text></View><Text className="font-semibold text-danger">−{money(row.amount)}</Text></Card>)}
    </ScrollView>
  );
}

export function AccountsScreen() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => { void loadBudget().then((data) => setAccounts(data.accounts)); }, []);
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 16 }}><Text className="text-3xl font-semibold text-foreground">Accounts</Text><Text className="text-muted">Balances are read from your local budget.</Text>{accounts.length === 0 ? <Card className="items-center gap-2 p-8"><Text className="text-muted">No accounts on this device yet.</Text><Text className="text-muted">Create one on the web app, then sync here.</Text></Card> : accounts.map((account) => <Card key={account.id} className="flex-row items-center justify-between p-4"><View><Text className="font-medium text-foreground">{account.name}</Text><Text className="text-muted">{account.type}</Text></View><Text selectable className="font-semibold text-foreground">{money(account.balance)}</Text></Card>)}</ScrollView>;
}

export function PlansScreen() {
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => { void loadBudget().then((data) => setPlans(data.plans)); }, []);
  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 16 }}><Text className="text-3xl font-semibold text-foreground">Plans & recurring</Text><Text className="text-muted">Keep upcoming commitments visible before they surprise you.</Text>{plans.length === 0 ? <Card className="items-center gap-2 p-8"><Text className="text-muted">No recurring plans synced yet.</Text><Text className="text-muted">Add plans on the web app to see them here.</Text></Card> : plans.map((plan) => <Card key={plan.id} className="flex-row items-center justify-between p-4"><View><Text className="font-medium text-foreground">{plan.name}</Text><Text className="text-muted">{plan.cadence} · next {plan.nextDate}</Text></View><Text className="font-semibold text-foreground">{money(plan.amount)}</Text></Card>)}</ScrollView>;
}
