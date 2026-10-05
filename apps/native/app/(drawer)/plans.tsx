import { Stack } from "expo-router";
import { PlansScreen } from "@/components/budget-screen";

export default function PlansRoute() {
  return <><Stack.Screen options={{ title: "Plans & recurring" }} /><PlansScreen /></>;
}
