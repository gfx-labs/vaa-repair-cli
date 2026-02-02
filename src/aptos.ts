import axios from "axios";
import type { MessageData } from "./assemble.js";
import { APTOS_RPC, APTOS_CORE_BRIDGE } from "./utils.js";

const APTOS_CHAIN_ID = 22;

interface AptosWormholeEvent {
  data: {
    consistency_level: number;
    nonce: string;
    payload: string;
    sender: string;
    sequence: string;
    timestamp: string;
  };
}

export async function getMessageFromAptosEvent(eventSequence: bigint): Promise<MessageData> {
  const eventHandle = `${APTOS_CORE_BRIDGE}::state::WormholeMessageHandle`;
  const url = `${APTOS_RPC}/accounts/${APTOS_CORE_BRIDGE}/events/${eventHandle}/event?start=${eventSequence}&limit=1`;

  console.log(`Fetching Aptos event from: ${url}`);

  const response = await axios.get<AptosWormholeEvent[]>(url);
  const events = response.data;

  if (!events || events.length === 0) {
    throw new Error(`No event found at sequence ${eventSequence}`);
  }

  const { data } = events[0];

  return {
    timestamp: Number(data.timestamp),
    nonce: Number(data.nonce),
    emitterChain: APTOS_CHAIN_ID,
    emitterAddress: "0x" + BigInt(data.sender).toString(16),
    sequence: BigInt(data.sequence),
    consistencyLevel: data.consistency_level,
    payload: Buffer.from(data.payload.replace(/^0x/, ""), "hex"),
  };
}
