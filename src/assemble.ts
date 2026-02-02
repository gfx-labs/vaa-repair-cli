import { ethers } from "ethers";
import { getGuardianIndex, CURRENT_GUARDIAN_SET_INDEX, QUORUM_SIZE, getGuardianName } from "./guardians.js";
import { fetchObservations, decodeAptosTxHash, type Observation } from "./observations.js";
import { uint16BE, uint32BE, uint64BE, leftPad32, getRpcEndpoint } from "./utils.js";
import { getMessageFromAptosEvent } from "./aptos.js";
import { getMessageFromSolana, decodeSolanaTxHash } from "./solana.js";

const LOG_MESSAGE_PUBLISHED_TOPIC = "0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2";

const CHAIN_SOLANA = 1;
const CHAIN_APTOS = 22;

export interface MessageData {
  timestamp: number;
  nonce: number;
  emitterChain: number;
  emitterAddress: string;
  sequence: bigint;
  consistencyLevel: number;
  payload: Buffer;
}

interface SignedObservation {
  index: number;
  signature: Buffer;
}

async function getMessageFromTx(rpcUrl: string, txHash: string, chainId: number): Promise<MessageData> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const receipt = await provider.getTransactionReceipt(txHash);

  if (!receipt) {
    throw new Error(`Transaction not found: ${txHash}`);
  }

  const log = receipt.logs.find((l) => l.topics[0] === LOG_MESSAGE_PUBLISHED_TOPIC);

  if (!log) {
    throw new Error("LogMessagePublished event not found in transaction");
  }

  const sequence = BigInt(log.topics[1]);
  const data = log.data.slice(2);
  const nonce = parseInt(data.slice(0, 64), 16);
  const consistencyLevel = parseInt(data.slice(128, 192), 16);
  const payloadLength = parseInt(data.slice(192, 256), 16);
  const payload = data.slice(256, 256 + payloadLength * 2);

  const block = await provider.getBlock(receipt.blockNumber);
  if (!block) {
    throw new Error(`Block not found: ${receipt.blockNumber}`);
  }

  return {
    timestamp: Number(block.timestamp),
    nonce,
    emitterChain: chainId,
    emitterAddress: log.address,
    sequence,
    consistencyLevel,
    payload: Buffer.from(payload, "hex"),
  };
}

function sortAndLimitObservations(observations: Observation[]): SignedObservation[] {
  return observations
    .map((obs) => ({
      index: getGuardianIndex(obs.guardianAddr),
      signature: Buffer.from(obs.signature, "base64"),
    }))
    .sort((a, b) => a.index - b.index)
    .slice(0, QUORUM_SIZE);
}

function buildVAABody(message: MessageData): Buffer {
  return Buffer.concat([
    uint32BE(message.timestamp),
    uint32BE(message.nonce),
    uint16BE(message.emitterChain),
    leftPad32(message.emitterAddress),
    uint64BE(message.sequence),
    Buffer.from([message.consistencyLevel]),
    message.payload,
  ]);
}

function assembleVAA(message: MessageData, observations: Observation[]): Buffer {
  const sortedObs = sortAndLimitObservations(observations);
  const body = buildVAABody(message);

  return Buffer.concat([
    Buffer.from([1]), // version
    uint32BE(CURRENT_GUARDIAN_SET_INDEX),
    Buffer.from([sortedObs.length]),
    ...sortedObs.map((obs) => Buffer.concat([Buffer.from([obs.index]), obs.signature])),
    body,
  ]);
}

function formatEmitterAddress(emitterAddress: string): string {
  return emitterAddress.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

function logGuardians(observations: Observation[]): void {
  for (const obs of observations) {
    const idx = getGuardianIndex(obs.guardianAddr);
    console.log(`    [${idx}] ${getGuardianName(idx)}`);
  }
}

export async function assembleVAAFromObservations(
  chainId: number,
  emitterAddress: string,
  sequence: bigint,
  chainName?: string,
  rpcUrl?: string
): Promise<{ vaa: Buffer; message: MessageData; sigCount: number }> {
  const formattedEmitter = formatEmitterAddress(emitterAddress);

  console.log(`\n[1/3] Fetching guardian observations...`);
  const observations = await fetchObservations(chainId, formattedEmitter, sequence);

  console.log(`  Found ${observations.length} observations`);

  if (observations.length < QUORUM_SIZE) {
    console.log(`\n  Guardians who signed:`);
    logGuardians(observations);
    throw new Error(`Insufficient observations: ${observations.length}/${QUORUM_SIZE} required for quorum`);
  }

  console.log(`  Quorum reached (${observations.length}/${QUORUM_SIZE})`);
  console.log(`\n  Guardians who signed:`);
  logGuardians(observations);

  const firstObs = observations[0];
  if (!firstObs.txHash) {
    throw new Error("Observation missing txHash field");
  }

  const message = await fetchMessage(chainId, firstObs.txHash, formattedEmitter, sequence, chainName, rpcUrl);

  console.log(`  Emitter: ${message.emitterAddress}`);
  console.log(`  Sequence: ${message.sequence}`);
  console.log(`  Timestamp: ${new Date(message.timestamp * 1000).toISOString()}`);
  console.log(`  Nonce: ${message.nonce}`);
  console.log(`  Payload: ${message.payload.length} bytes`);

  console.log(`\n[3/3] Assembling VAA...`);
  const vaa = assembleVAA(message, observations);

  console.log(`  VAA size: ${vaa.length} bytes`);

  return { vaa, message, sigCount: observations.length };
}

async function fetchMessage(
  chainId: number,
  txHash: string,
  formattedEmitter: string,
  sequence: bigint,
  chainName?: string,
  rpcUrl?: string
): Promise<MessageData> {
  if (chainId === CHAIN_SOLANA) {
    const txSignature = decodeSolanaTxHash(txHash);
    console.log(`\n[2/3] Fetching message from Solana...`);
    return getMessageFromSolana(txSignature, formattedEmitter, sequence);
  }

  if (chainId === CHAIN_APTOS) {
    const eventSequence = decodeAptosTxHash(txHash);
    console.log(`\n[2/3] Fetching message from Aptos (event sequence: ${eventSequence})...`);
    return getMessageFromAptosEvent(eventSequence);
  }

  const txHashBuffer = Buffer.from(txHash, "base64");
  const evmTxHash = "0x" + txHashBuffer.toString("hex");
  console.log(`\n[2/3] Fetching message from EVM chain (tx: ${evmTxHash})...`);

  const rpc = rpcUrl || (chainName ? getRpcEndpoint(chainName) : null);
  if (!rpc) {
    throw new Error(`No RPC endpoint available for chain ${chainId}. Use --rpc to specify one.`);
  }

  return getMessageFromTx(rpc, evmTxHash, chainId);
}
