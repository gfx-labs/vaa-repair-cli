import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BINARY_PATHS = [
  path.join(__dirname, "..", "bin", "broadcast-vaa"),
  path.join(__dirname, "..", "..", "bin", "broadcast-vaa"),
  path.join(process.cwd(), "bin", "broadcast-vaa"),
];

const DEFAULT_TIMEOUT = 60;

export interface BroadcastOptions {
  network?: "mainnet" | "testnet";
  timeout?: number;
}

function findBroadcastBinary(): string {
  for (const candidate of BINARY_PATHS) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("broadcast-vaa binary not found. Run 'npm run build:go' to build it.");
}

export async function broadcastVAA(vaaHex: string, options: BroadcastOptions = {}): Promise<void> {
  const binaryPath = findBroadcastBinary();
  const network = options.network || "mainnet";
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  console.log(`\nBroadcasting VAA to ${network} gossip network...`);

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, [vaaHex, "--network", network, "--timeout", timeout.toString()], {
      stdio: ["inherit", "pipe", "pipe"],
    });

    let stderr = "";

    child.stdout?.on("data", (data) => process.stdout.write(data.toString()));
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
      process.stderr.write(data.toString());
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Broadcast failed with code ${code}: ${stderr}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn broadcast binary: ${err.message}`));
    });
  });
}
