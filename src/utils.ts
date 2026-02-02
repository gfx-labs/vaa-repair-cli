import {
  chains as sdkChains,
  chainToChainId,
  chainIdToChain,
  CONFIG,
  type ChainId,
  type Chain,
} from "@wormhole-foundation/sdk";

export function uint16BE(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(n);
  return buf;
}

export function uint32BE(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(n);
  return buf;
}

export function uint64BE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(n);
  return buf;
}

export function leftPad32(hexStr: string): Buffer {
  const clean = hexStr.replace(/^0x/, "").toLowerCase();
  return Buffer.from(clean.padStart(64, "0"), "hex");
}

export const CHAIN_IDS: Record<string, number> = Object.fromEntries(
  sdkChains.map((chain) => [chain.toLowerCase(), chainToChainId(chain)])
);

export const RPC_ENDPOINTS: Record<string, string> = {
  ethereum: "https://eth.drpc.org",
  base: "https://base.drpc.org",
  arbitrum: "https://arbitrum.drpc.org",
  optimism: "https://optimism.drpc.org",
  polygon: "https://polygon.drpc.org",
  avalanche: "https://avalanche.drpc.org",
  bsc: "https://bsc.drpc.org",
  hyperevm: "https://rpc.hyperliquid.xyz/evm",
};

export function getCoreBridge(chain: string): string {
  const coreBridge = CONFIG.Mainnet?.chains?.[chain as Chain]?.contracts?.coreBridge;
  if (!coreBridge) {
    throw new Error(`No core bridge configured for chain: ${chain}`);
  }
  return coreBridge;
}

export const APTOS_RPC = "https://fullnode.mainnet.aptoslabs.com/v1";
export const APTOS_CORE_BRIDGE = getCoreBridge("Aptos");

export const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
export const SOLANA_CORE_BRIDGE = getCoreBridge("Solana");

export function getChainId(chainName: string): number {
  const id = CHAIN_IDS[chainName.toLowerCase()];
  if (id === undefined) {
    throw new Error(`Unknown chain: ${chainName}`);
  }
  return id;
}

export function getChainName(chainId: number): string {
  try {
    return chainIdToChain(chainId as ChainId);
  } catch {
    return `Chain ${chainId}`;
  }
}

export function getRpcEndpoint(chainName: string): string {
  const rpc = RPC_ENDPOINTS[chainName.toLowerCase()];
  if (!rpc) {
    throw new Error(`No RPC endpoint configured for chain: ${chainName}`);
  }
  return rpc;
}
