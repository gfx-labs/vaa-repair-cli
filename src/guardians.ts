const GUARDIAN_SET_URL = "https://raw.githubusercontent.com/wormhole-foundation/wormhole/main/guardianset/mainnetv2";
const GUARDIAN_VERSIONS = [1, 2, 3, 4, 5];

interface GuardianSet {
  addresses: string[];
  names: string[];
}

const guardianSets: Record<number, GuardianSet> = {};
let activeVersion = 5;
let initialized = false;

export const DEFAULT_VERSION = 5;
export const QUORUM_SIZE = 13;

function parseProtoTxt(content: string): GuardianSet {
  const addresses: string[] = [];
  const names: string[] = [];
  const pattern = /guardians:\s*\{[^}]*pubkey:\s*"(0x[a-fA-F0-9]+)"[^}]*name:\s*"([^"]+)"[^}]*\}/g;

  let match;
  while ((match = pattern.exec(content)) !== null) {
    addresses.push(match[1]);
    names.push(match[2]);
  }

  return { addresses, names };
}

async function fetchSet(version: number): Promise<GuardianSet> {
  const url = `${GUARDIAN_SET_URL}/v${version}.prototxt`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch v${version}: ${response.status}`);
  }

  return parseProtoTxt(await response.text());
}

export async function initialize(): Promise<void> {
  if (initialized) return;

  console.log("Fetching guardian sets from GitHub...");

  const results = await Promise.all(
    GUARDIAN_VERSIONS.map(async (v) => {
      try {
        return { version: v, set: await fetchSet(v) };
      } catch (err) {
        console.error(`Warning: Failed to fetch v${v}:`, err);
        return null;
      }
    })
  );

  for (const result of results) {
    if (result) guardianSets[result.version] = result.set;
  }

  const loaded = Object.keys(guardianSets).sort().join(", ");
  console.log(`Loaded guardian sets: v${loaded}`);

  initialized = true;
}

export function getAvailableVersions(): number[] {
  return Object.keys(guardianSets).map(Number).sort((a, b) => a - b);
}

export function setActive(version: number): void {
  if (!guardianSets[version]) {
    throw new Error(`Unknown guardian set: ${version}. Available: ${getAvailableVersions().join(", ")}`);
  }
  activeVersion = version;
}

export function getActiveVersion(): number {
  return activeVersion;
}

function getActive(): GuardianSet {
  const set = guardianSets[activeVersion];
  if (!set) {
    throw new Error(`Guardian set v${activeVersion} not loaded. Call initialize() first.`);
  }
  return set;
}

export function getIndex(address: string): number {
  const normalized = address.toLowerCase();
  return getActive().addresses.findIndex((a) => a.toLowerCase() === normalized);
}

export function isKnown(address: string): boolean {
  return getIndex(address) !== -1;
}

export function getName(index: number): string {
  return getActive().names[index] ?? "Unknown";
}
