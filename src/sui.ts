import axios from "axios";
import bs58 from "bs58";
import type { MessageData } from "./assemble.js";
import { SUI_RPC } from "./utils.js";

const SUI_CHAIN_ID = 21;
const WORMHOLE_EVENT_TYPE = "::publish_message::WormholeMessage";

interface WormholeMessageEvent {
  type: string;
  parsedJson: {
    sender: string;
    sequence: string;
    nonce: number;
    payload: number[];
    consistency_level: number;
    timestamp: string;
  };
}

interface TransactionResponse {
  result: {
    events?: WormholeMessageEvent[];
  };
}

export function decodeTxHash(base64Hash: string): string {
  return bs58.encode(Buffer.from(base64Hash, "base64"));
}

export async function getMessage(txDigest: string, rpcUrl?: string): Promise<MessageData> {
  const rpc = rpcUrl || SUI_RPC;

  const response = await axios.post<TransactionResponse>(rpc, {
    jsonrpc: "2.0",
    id: 1,
    method: "sui_getTransactionBlock",
    params: [txDigest, { showEvents: true }],
  });

  const events = response.data.result?.events || [];
  const event = events.find((e) => e.type.endsWith(WORMHOLE_EVENT_TYPE));

  if (!event) {
    throw new Error(`WormholeMessage event not found. Found ${events.length} events.`);
  }

  const { parsedJson } = event;
  const emitter = parsedJson.sender.replace(/^0x/, "").padStart(64, "0");

  return {
    timestamp: Number(parsedJson.timestamp),
    nonce: parsedJson.nonce,
    emitterChain: SUI_CHAIN_ID,
    emitterAddress: emitter,
    sequence: BigInt(parsedJson.sequence),
    consistencyLevel: parsedJson.consistency_level,
    payload: Buffer.from(parsedJson.payload),
  };
}
