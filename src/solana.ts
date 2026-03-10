import { Connection, PublicKey } from "@solana/web3.js";
import type { MessageData } from "./assemble.js";
import { SOLANA_RPC, SOLANA_CORE_BRIDGE } from "./utils.js";
import bs58 from "bs58";

const CHAIN_ID = 1;
const MSG_DISCRIMINATOR = "msu";

const OFFSET = {
  CONSISTENCY_LEVEL: 4,
  NONCE: 45,
  SEQUENCE: 49,
  EMITTER_CHAIN: 57,
  EMITTER_ADDRESS: 59,
  PAYLOAD_LENGTH: 91,
} as const;

export function decodeTxHash(base64Hash: string): string {
  return bs58.encode(Buffer.from(base64Hash, "base64"));
}

export async function getMessage(
  txSignature: string,
  expectedEmitter: string,
  expectedSequence: bigint
): Promise<MessageData> {
  const connection = new Connection(SOLANA_RPC, "confirmed");
  const coreBridge = new PublicKey(SOLANA_CORE_BRIDGE);

  console.log(`  Transaction: ${txSignature}`);

  const tx = await connection.getTransaction(txSignature, {
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    throw new Error(`Transaction not found: ${txSignature}`);
  }

  if (!tx.blockTime) {
    throw new Error("Transaction missing block time");
  }

  const emitter = expectedEmitter.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const data = await findMessageAccount(connection, tx, coreBridge, emitter, expectedSequence);

  if (!data) {
    throw new Error("Could not find Posted Message account in transaction");
  }

  return parseMessage(data, tx.blockTime, expectedSequence);
}

async function findMessageAccount(
  connection: Connection,
  tx: Awaited<ReturnType<Connection["getTransaction"]>>,
  coreBridge: PublicKey,
  emitter: string,
  sequence: bigint
): Promise<Buffer | null> {
  const accountKeys = tx!.transaction.message.getAccountKeys();
  let fallback: Buffer | null = null;

  for (let i = 0; i < accountKeys.length; i++) {
    const account = accountKeys.get(i);
    if (!account) continue;

    try {
      const info = await connection.getAccountInfo(account);
      if (!info || !info.owner.equals(coreBridge) || info.data.length <= 91) continue;

      const discriminator = info.data.slice(0, 3).toString();
      if (discriminator !== MSG_DISCRIMINATOR) continue;

      const emitterHex = info.data.slice(OFFSET.EMITTER_ADDRESS, OFFSET.EMITTER_ADDRESS + 32).toString("hex");
      const seq = info.data.readBigUInt64LE(OFFSET.SEQUENCE);

      if (emitterHex === emitter && seq === sequence) {
        return info.data;
      }

      if (!fallback) {
        fallback = info.data;
      }
    } catch {
      continue;
    }
  }

  return fallback;
}

function parseMessage(data: Buffer, timestamp: number, expectedSequence: bigint): MessageData {
  const sequence = data.readBigUInt64LE(OFFSET.SEQUENCE);

  if (sequence !== expectedSequence) {
    console.log(`  Warning: Account sequence ${sequence} differs from expected ${expectedSequence}`);
  }

  const payloadLen = data.readUInt32LE(OFFSET.PAYLOAD_LENGTH);

  return {
    timestamp,
    nonce: data.readUInt32LE(OFFSET.NONCE),
    emitterChain: data.readUInt16LE(OFFSET.EMITTER_CHAIN),
    emitterAddress: data.slice(OFFSET.EMITTER_ADDRESS, OFFSET.EMITTER_ADDRESS + 32).toString("hex"),
    sequence: expectedSequence,
    consistencyLevel: data.readUInt8(OFFSET.CONSISTENCY_LEVEL),
    payload: Buffer.from(data.slice(OFFSET.PAYLOAD_LENGTH + 4, OFFSET.PAYLOAD_LENGTH + 4 + payloadLen)),
  };
}
