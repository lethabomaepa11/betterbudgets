import { Stack } from "expo-router";
import { DashboardScreen } from "@/components/budget-screen";

export default function Home() {
  return <><Stack.Screen options={{ title: "Dashboard" }} /><DashboardScreen /></>;
}
