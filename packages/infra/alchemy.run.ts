import * as Alchemy from "alchemy";
import * as Axiom from "alchemy/Axiom";
import * as Command from "alchemy/Command";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import "varlock/auto-load";

export const observability = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const datasetName = `betterbudgets-${stage}-logs`;

  const dataset = yield* Axiom.Dataset("logs", {
    name: datasetName,
    kind: "axiom:events:v1",
    description: "betterbudgets application logs",
  });
  const ingest = yield* Axiom.ApiToken("logs-ingest", {
    name: `betterbudgets-${stage}-logs-ingest`,
    datasetCapabilities: {
      [datasetName]: {
        ingest: ["create"],
      },
    },
  });

  return {
    dataset,
    runtimeEnv: {
      AXIOM_API_KEY: ingest.token,
      AXIOM_DATASET: dataset.name,
      AXIOM_EDGE_URL: dataset.edgeDeploymentUrl,
    },
  };
});

export default Alchemy.Stack(
  "betterbudgets",
  {
    providers: Layer.mergeAll(Axiom.providers(), Command.providers()),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const observabilityResources = yield* observability;
    const serverDev = yield* Command.Dev("server-dev", {
      command: "pnpm run dev:bare",
      cwd: "../../apps/server",
      env: observabilityResources.runtimeEnv,
    });
    const webDev = yield* Command.Dev("web-dev", {
      command: "pnpm run dev:bare",
      cwd: "../../apps/web",
      env: observabilityResources.runtimeEnv,
    });

    return {
      web: webDev.url,
      server: serverDev.url,
      axiomDataset: observabilityResources.dataset.name,
    };
  }),
);
