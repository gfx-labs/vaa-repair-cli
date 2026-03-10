#!/usr/bin/env node

import { program } from "commander";
import { assembleVAAFromObservations } from "./assemble.js";
import { broadcastVAA } from "./broadcast.js";
import { checkExistingVAA } from "./observations.js";
import { getChainName, CHAIN_IDS } from "./utils.js";
import * as guardians from "./guardians.js";

function parseVaaId(vaaId: string): { chainId: number; emitter: string; sequence: bigint } {
  const parts = vaaId.split("/");
  if (parts.length !== 3) {
    console.error("Error: VAA ID must be in format: chainId/emitter/sequence");
    console.error("Example: 22/00000000000000000000000000000000000000000000000000000000000008b3/31");
    process.exit(1);
  }

  const [chainIdStr, emitter, sequenceStr] = parts;
  const chainId = parseInt(chainIdStr, 10);

  if (isNaN(chainId)) {
    console.error("Error: Invalid chain ID");
    process.exit(1);
  }

  return { chainId, emitter, sequence: BigInt(sequenceStr) };
}

async function main() {
  await guardians.initialize();

  program
    .name("vaa-repair")
    .description("Recover and broadcast Wormhole VAAs from guardian observations")
    .version("1.0.0");

  program
    .command("assemble")
    .description("Assemble a VAA from guardian observations")
    .argument("<vaa-id>", "VAA ID in format: chainId/emitter/sequence")
    .option("--rpc <url>", "Custom RPC endpoint URL")
    .option("--output <format>", "Output format: hex or base64", "hex")
    .option("--broadcast", "Broadcast the VAA after assembly")
    .option("--network <net>", "Gossip network: mainnet or testnet", "mainnet")
    .option("--guardian-set <index>", "Guardian set index to use", String(guardians.DEFAULT_VERSION))
    .action(async (vaaId: string, options) => {
      try {
        const version = parseInt(options.guardianSet, 10);
        guardians.setActive(version);
        console.log(`Using guardian set v${version}`);

        const { chainId, emitter, sequence } = parseVaaId(vaaId);
        const chainName = getChainName(chainId);

        console.log(`Assembling VAA for ${chainName}...`);
        console.log(`  Emitter: ${emitter}`);
        console.log(`  Sequence: ${sequence}`);

        const { vaa, message, sigCount } = await assembleVAAFromObservations(
          chainId,
          emitter,
          sequence,
          chainName,
          options.rpc
        );

        const exists = await checkExistingVAA(message.emitterChain, message.emitterAddress, message.sequence);
        if (exists) {
          console.log("\nNote: VAA already exists on Wormholescan");
        }

        console.log("\n--- Assembled VAA ---");
        console.log(options.output === "base64" ? vaa.toString("base64") : vaa.toString("hex"));
        console.log("---");

        if (options.broadcast) {
          await broadcastVAA(vaa.toString("hex"), {
            network: options.network as "mainnet" | "testnet",
          });
        }

        console.log("\nDone!");
      } catch (error) {
        console.error("\nError:", (error as Error).message);
        process.exit(1);
      }
    });

  program
    .command("broadcast")
    .description("Broadcast an already-assembled VAA to the gossip network")
    .requiredOption("--vaa <hex>", "VAA in hex format")
    .option("--network <net>", "Gossip network: mainnet or testnet", "mainnet")
    .option("--timeout <seconds>", "Connection timeout in seconds", "60")
    .action(async (options) => {
      try {
        await broadcastVAA(options.vaa, {
          network: options.network as "mainnet" | "testnet",
          timeout: parseInt(options.timeout, 10),
        });
        console.log("\nDone!");
      } catch (error) {
        console.error("\nError:", (error as Error).message);
        process.exit(1);
      }
    });

  program
    .command("chains")
    .description("List supported chain names and IDs")
    .action(() => {
      console.log("\nSupported chains:\n");
      const sorted = Object.entries(CHAIN_IDS).sort((a, b) => a[1] - b[1]);
      for (const [name, id] of sorted) {
        console.log(`  ${name.padEnd(15)} ${id}`);
      }
      console.log();
    });

  program
    .command("guardian-sets")
    .description("List available guardian sets")
    .action(() => {
      const versions = guardians.getAvailableVersions();
      console.log("\nAvailable guardian sets:");
      for (const v of versions) {
        const marker = v === guardians.DEFAULT_VERSION ? " (default)" : "";
        console.log(`  v${v}${marker}`);
      }
      console.log();
    });

  program.parse();
}

main().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
