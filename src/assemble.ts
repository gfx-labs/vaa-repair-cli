import { ethers } from "ethers";
import * as guardians from "./guardians.js";
import { fetchObservations, decodeAptosTxHash, type Observation } from "./observations.js";
import { uint16BE, uint32BE, uint64BE, leftPad32, getRpcEndpoint } from "./utils.js";
import { getMessage as getAptosMessage } from "./aptos.js";
import { getMessage as getSolanaMessage, decodeTxHash as decodeSolanaTxHash } from "./solana.js";
import { getMessage as getSuiMessage, decodeTxHash as decodeSuiTxHash } from "./sui.js";

const LOG_MESSAGE_PUBLISHED_TOPIC = "0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2";

const CHAIN_SOLANA = 1;
const CHAIN_SUI = 21;
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

async function getMessageFromTx(rpcUrl: string, txHash: string, chainId: number, expectedEmitter: string): Promise<MessageData> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const receipt = await provider.getTransactionReceipt(txHash);

  if (!receipt) {
    throw new Error(`Transaction not found: ${txHash}`);
  }

  // Filter by topic and emitter address (topics[1] is the indexed sender/emitter)
  const normalizedEmitter = expectedEmitter.replace(/^0+/, "").toLowerCase();
  const log = receipt.logs.find((l) => {
    if (l.topics[0] !== LOG_MESSAGE_PUBLISHED_TOPIC) return false;
    if (!l.topics[1]) return false;
    // topics[1] is the indexed sender address (the emitter), left-padded to 32 bytes
    const logEmitter = l.topics[1].slice(2).replace(/^0+/, "").toLowerCase();
    return logEmitter === normalizedEmitter;
  });

  if (!log) {
    throw new Error(`LogMessagePublished event not found for emitter ${expectedEmitter} in transaction`);
  }

  // Event: LogMessagePublished(address indexed sender, uint64 sequence, uint32 nonce, bytes payload, uint8 consistencyLevel)
  // topics[1] = sender (emitter address)
  // data layout (ABI encoded):
  //   - bytes 0-32: sequence (uint64, right-aligned)
  //   - bytes 32-64: nonce (uint32, right-aligned)
  //   - bytes 64-96: offset to payload (uint256)
  //   - bytes 96-128: consistencyLevel (uint8, right-aligned)
  //   - bytes 128+: payload (length prefix + data)
  const data = log.data.slice(2); // remove 0x prefix
  const sequence = BigInt("0x" + data.slice(0, 64));
  const nonce = parseInt(data.slice(64, 128), 16);
  const consistencyLevel = parseInt(data.slice(192, 256), 16);
  // Payload starts at offset 0x80 (128 bytes = 256 hex chars), first 32 bytes is length
  const payloadLength = parseInt(data.slice(256, 320), 16);
  const payload = data.slice(320, 320 + payloadLength * 2);

  // Emitter is from topics[1], not log.address (which is the core bridge)
  const emitterAddress = log.topics[1];

  const block = await provider.getBlock(receipt.blockNumber);
  if (!block) {
    throw new Error(`Block not found: ${receipt.blockNumber}`);
  }

  return {
    timestamp: Number(block.timestamp),
    nonce,
    emitterChain: chainId,
    emitterAddress,
    sequence,
    consistencyLevel,
    payload: Buffer.from(payload, "hex"),
  };
}

function sortAndLimitObservations(observations: Observation[]): SignedObservation[] {
  return observations
    .map((obs) => ({
      index: guardians.getIndex(obs.guardianAddr),
      signature: Buffer.from(obs.signature, "base64"),
    }))
    .sort((a, b) => a.index - b.index)
    .slice(0, guardians.QUORUM_SIZE);
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
    uint32BE(guardians.getActiveVersion()),
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
    const idx = guardians.getIndex(obs.guardianAddr);
    console.log(`    [${idx}] ${guardians.getName(idx)}`);
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
  const version = guardians.getActiveVersion();

  console.log(`\n[1/3] Fetching guardian observations...`);
  const allObservations = await fetchObservations(chainId, formattedEmitter, sequence);
  const observations = allObservations.filter((obs) => guardians.isKnown(obs.guardianAddr));

  const skipped = allObservations.length - observations.length;
  console.log(`  Found ${allObservations.length} observations${skipped > 0 ? ` (${skipped} from non-v${version} guardians, skipped)` : ""}`);

  if (observations.length < guardians.QUORUM_SIZE) {
    console.log(`\n  Guardians who signed (v${version} set):`);
    logGuardians(observations);
    throw new Error(`Insufficient v${version} observations: ${observations.length}/${guardians.QUORUM_SIZE} required for quorum`);
  }

  console.log(`  Quorum reached (${observations.length}/${guardians.QUORUM_SIZE})`);
  console.log(`\n  Guardians who signed (v${version} set):`);
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
    return getSolanaMessage(txSignature, formattedEmitter, sequence);
  }

  if (chainId === CHAIN_SUI) {
    const txDigest = decodeSuiTxHash(txHash);
    console.log(`\n[2/3] Fetching message from Sui (tx: ${txDigest})...`);
    return getSuiMessage(txDigest, rpcUrl);
  }

  if (chainId === CHAIN_APTOS) {
    const eventSequence = decodeAptosTxHash(txHash);
    console.log(`\n[2/3] Fetching message from Aptos (event sequence: ${eventSequence})...`);
    return getAptosMessage(eventSequence);
  }

  const txHashBuffer = Buffer.from(txHash, "base64");
  const evmTxHash = "0x" + txHashBuffer.toString("hex");
  console.log(`\n[2/3] Fetching message from EVM chain (tx: ${evmTxHash})...`);

  const rpc = rpcUrl || (chainName ? getRpcEndpoint(chainName) : null);
  if (!rpc) {
    throw new Error(`No RPC endpoint available for chain ${chainId}. Use --rpc to specify one.`);
  }

  return getMessageFromTx(rpc, evmTxHash, chainId, formattedEmitter);
}
