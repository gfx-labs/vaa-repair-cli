import axios from "axios";

const WORMHOLESCAN_API = "https://api.wormholescan.io/api/v1";

export interface Observation {
  guardianAddr: string;
  signature: string;
  hash: string;
  txHash?: string;
}

export function decodeAptosTxHash(base64TxHash: string): bigint {
  const buffer = Buffer.from(base64TxHash, "base64");
  let result = BigInt(0);
  for (let i = 0; i < buffer.length; i++) {
    result = (result << BigInt(8)) | BigInt(buffer[i]);
  }
  return result;
}

function formatEmitterAddress(emitterAddress: string): string {
  return emitterAddress.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

export async function fetchObservations(
  emitterChain: number,
  emitterAddress: string,
  sequence: bigint
): Promise<Observation[]> {
  const formattedEmitter = formatEmitterAddress(emitterAddress);
  const url = `${WORMHOLESCAN_API}/observations/${emitterChain}/${formattedEmitter}/${sequence}`;

  console.log(`Fetching observations from: ${url}`);

  try {
    const response = await axios.get<Observation[]>(url);
    return response.data || [];
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return [];
    }
    throw error;
  }
}

export async function checkExistingVAA(
  emitterChain: number,
  emitterAddress: string,
  sequence: bigint
): Promise<boolean> {
  const formattedEmitter = formatEmitterAddress(emitterAddress);
  const url = `${WORMHOLESCAN_API}/vaas/${emitterChain}/${formattedEmitter}/${sequence}`;

  try {
    const response = await axios.get(url);
    return response.data?.data != null;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return false;
    }
    throw error;
  }
}
