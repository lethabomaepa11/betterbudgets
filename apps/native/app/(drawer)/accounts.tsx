import { Stack } from "expo-router";
import { AccountsScreen } from "@/components/budget-screen";

export default function AccountsRoute() {
  return <><Stack.Screen options={{ title: "Accounts" }} /><AccountsScreen /></>;
}
