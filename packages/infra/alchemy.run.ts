import * as Alchemy from "alchemy";
import * as Command from "alchemy/Command";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import "varlock/auto-load";

export default Alchemy.Stack(
  "betterbudgets",
  {
    providers: Layer.mergeAll(Command.providers()),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const serverDev = yield* Command.Dev("server-dev", {
      command: "pnpm run dev:bare",
      cwd: "../../apps/server",
    });
    const webDev = yield* Command.Dev("web-dev", {
      command: "pnpm run dev:bare",
      cwd: "../../apps/web",
    });

    return {
      web: webDev.url,
      server: serverDev.url,
    };
  }),
);
