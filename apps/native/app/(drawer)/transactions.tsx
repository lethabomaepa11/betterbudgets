import { Stack } from "expo-router";
import { TransactionsScreen } from "@/components/budget-screen";

export default function TransactionsRoute() {
  return <><Stack.Screen options={{ title: "Transactions" }} /><TransactionsScreen /></>;
}
