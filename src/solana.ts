import { Connection, PublicKey } from "@solana/web3.js";
import type { MessageData } from "./assemble.js";
import { SOLANA_RPC, SOLANA_CORE_BRIDGE } from "./utils.js";
import bs58 from "bs58";

const MSU_DISCRIMINATOR = "msu";

const OFFSETS = {
  CONSISTENCY_LEVEL: 4,
  NONCE: 45,
  SEQUENCE: 49,
  EMITTER_CHAIN: 57,
  EMITTER_ADDRESS: 59,
  PAYLOAD_LENGTH: 91,
} as const;

export function decodeSolanaTxHash(base64TxHash: string): string {
  return bs58.encode(Buffer.from(base64TxHash, "base64"));
}

export async function getMessageFromSolana(
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

  const expectedEmitterNorm = expectedEmitter.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const messageData = await findMessageAccount(connection, tx, coreBridge, expectedEmitterNorm, expectedSequence);

  if (!messageData) {
    throw new Error("Could not find Posted Message account in transaction");
  }

  return parseMessageData(messageData, tx.blockTime, expectedSequence);
}

async function findMessageAccount(
  connection: Connection,
  tx: Awaited<ReturnType<Connection["getTransaction"]>>,
  coreBridge: PublicKey,
  expectedEmitter: string,
  expectedSequence: bigint
): Promise<Buffer | null> {
  const accountKeys = tx!.transaction.message.getAccountKeys();
  let fallbackData: Buffer | null = null;

  for (let i = 0; i < accountKeys.length; i++) {
    const account = accountKeys.get(i);
    if (!account) continue;

    try {
      const info = await connection.getAccountInfo(account);
      if (!info || !info.owner.equals(coreBridge) || info.data.length <= 91) continue;

      const discriminator = info.data.slice(0, 3).toString();
      if (discriminator !== MSU_DISCRIMINATOR) continue;

      const emitterHex = info.data.slice(OFFSETS.EMITTER_ADDRESS, OFFSETS.EMITTER_ADDRESS + 32).toString("hex");
      const sequence = info.data.readBigUInt64LE(OFFSETS.SEQUENCE);

      if (emitterHex === expectedEmitter && sequence === expectedSequence) {
        return info.data;
      }

      if (!fallbackData) {
        fallbackData = info.data;
      }
    } catch {
      continue;
    }
  }

  return fallbackData;
}

function parseMessageData(data: Buffer, timestamp: number, expectedSequence: bigint): MessageData {
  const sequence = data.readBigUInt64LE(OFFSETS.SEQUENCE);

  if (sequence !== expectedSequence) {
    console.log(`  Warning: Account sequence ${sequence} differs from expected ${expectedSequence}`);
    console.log(`  Using block timestamp and on-chain emitter data`);
  }

  const payloadLen = data.readUInt32LE(OFFSETS.PAYLOAD_LENGTH);

  return {
    timestamp,
    nonce: data.readUInt32LE(OFFSETS.NONCE),
    emitterChain: data.readUInt16LE(OFFSETS.EMITTER_CHAIN),
    emitterAddress: data.slice(OFFSETS.EMITTER_ADDRESS, OFFSETS.EMITTER_ADDRESS + 32).toString("hex"),
    sequence: expectedSequence,
    consistencyLevel: data.readUInt8(OFFSETS.CONSISTENCY_LEVEL),
    payload: Buffer.from(data.slice(OFFSETS.PAYLOAD_LENGTH + 4, OFFSETS.PAYLOAD_LENGTH + 4 + payloadLen)),
  };
}
