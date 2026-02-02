# VAA Repair CLI

A CLI tool to recover and broadcast Wormhole VAAs when messages are emitted but never published.

## What it does

When a Wormhole message is emitted on-chain but the VAA never gets indexed (due to guardian issues, network problems, etc.), this tool can:

1. **Fetch** guardian observations from the Wormholescan API
2. **Retrieve** the original message data from the source chain
3. **Assemble** a valid VAA with the collected signatures
4. **Broadcast** the VAA to the Wormhole P2P gossip network

## Prerequisites

- Node.js 18+
- Go 1.21+ (for building the broadcast binary)

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/vaa-repair-cli-tool.git
cd vaa-repair-cli-tool

# Install dependencies
npm install

# Build everything (TypeScript + Go binary)
npm run build:all
```

## Quick Start

```bash
# Assemble and broadcast a VAA using its ID (chain/emitter/sequence)
npx vaa-repair assemble 22/00000000000000000000000000000000000000000000000000000000000008b3/31 --broadcast
```

## Usage

### Assemble a VAA

The tool accepts VAA IDs in the standard Wormhole format: `chainId/emitter/sequence`

```bash
# Assemble a VAA (outputs hex)
npx vaa-repair assemble 22/00000000000000000000000000000000000000000000000000000000000008b3/31

# Assemble and broadcast in one step
npx vaa-repair assemble 22/00000000000000000000000000000000000000000000000000000000000008b3/31 --broadcast

# Output as base64
npx vaa-repair assemble 2/0000000000000000000000003ee18b2214aff97000d974cf647e7c347e8fa585/12345 --output base64

# Use custom RPC for EVM chains
npx vaa-repair assemble 2/emitter/sequence --rpc https://my-rpc.com
```

### Broadcast an existing VAA

```bash
npx vaa-repair broadcast --vaa 01000000040d00...
```

### List supported chains

```bash
npx vaa-repair chains
```

## Supported Chains

The tool supports three chain families:

| Family | Chains | Notes |
|--------|--------|-------|
| **Solana** | Solana (1) | Parses Posted Message accounts |
| **Aptos** | Aptos (22) | Queries WormholeMessage events |
| **EVM** | All EVM chains | Parses LogMessagePublished events |

### EVM Chains with Built-in RPC

| Chain | ID |
|-------|-----|
| Ethereum | 2 |
| BSC | 4 |
| Polygon | 5 |
| Avalanche | 6 |
| Arbitrum | 23 |
| Optimism | 24 |
| Base | 30 |
| HyperEVM | 47 |

Other EVM chains work with the `--rpc` flag.

### Not Supported

The following chain families are **not currently supported** and would require dedicated implementations:

- **Sui** - Different Move VM and event structure
- **CosmWasm** (Terra2, Injective, Sei, Osmosis, etc.) - Different message format
- **Near** - Different account model
- **Algorand** - Different transaction structure

Run `npx vaa-repair chains` to see all chain IDs from the Wormhole SDK.

## Options

### `assemble`

| Option | Description |
|--------|-------------|
| `<vaa-id>` | VAA ID in format: `chainId/emitter/sequence` (required) |
| `--rpc <url>` | Custom RPC endpoint for EVM chains |
| `--output <format>` | Output format: `hex` or `base64` (default: `hex`) |
| `--broadcast` | Broadcast after assembly |
| `--network <net>` | Gossip network: `mainnet` or `testnet` (default: `mainnet`) |

### `broadcast`

| Option | Description |
|--------|-------------|
| `--vaa <hex>` | VAA in hex format (required) |
| `--network <net>` | Gossip network: `mainnet` or `testnet` (default: `mainnet`) |
| `--timeout <seconds>` | Connection timeout (default: `60`) |

## How it works

### VAA Assembly

1. Fetches guardian observations from Wormholescan API
2. Extracts transaction/event reference from observations
3. Fetches message data from the source chain:
   - **EVM chains**: Parses `LogMessagePublished` event from transaction receipt
   - **Aptos**: Queries Wormhole event by sequence number
   - **Solana**: Fetches Posted Message account from transaction
4. Verifies quorum (13 of 19 guardians required)
5. Sorts signatures by guardian index and assembles the VAA

### Gossip Broadcast

1. Connects to Wormhole bootstrap peers via libp2p (QUIC v1)
2. Joins the broadcast topic (`/wormhole/mainnet/2/broadcast`)
3. Wraps the VAA in the `SignedVAAWithQuorum` protobuf format
4. Publishes to the gossip network

The Go binary is used for broadcasting because libp2p's Go implementation is more mature and matches what guardians run.

## Troubleshooting

### "Insufficient observations"

The message doesn't have enough guardian signatures yet. Wait for more guardians to observe the message, or verify the VAA ID is correct.

### "broadcast-vaa binary not found"

Run `npm run build:go` to compile the Go broadcaster. Requires Go 1.21+.

### "Failed to connect to bootstrap peers"

Check your network connectivity. The tool needs outbound UDP (QUIC) access to port 8999.

### "No RPC endpoint available"

For chains without built-in RPC endpoints, use the `--rpc` flag to specify one.

### VAA already exists

If Wormholescan already has the VAA, you may not need to broadcast. The tool will note this but still allow you to proceed.

## Development

```bash
# Run without building (uses tsx)
npm run dev -- assemble 22/emitter/31

# Rebuild after changes
npm run build:all

# Build only TypeScript
npm run build

# Build only Go binary
npm run build:go
```

## Project Structure

```
vaa-repair-cli-tool/
├── src/
│   ├── index.ts          # CLI entry point
│   ├── assemble.ts       # VAA assembly logic
│   ├── aptos.ts          # Aptos event fetching
│   ├── solana.ts         # Solana message fetching
│   ├── broadcast.ts      # Spawns Go binary
│   ├── observations.ts   # Wormholescan API client
│   ├── guardians.ts      # Guardian set addresses
│   └── utils.ts          # Encoding helpers, chain config
├── broadcast/
│   └── main.go           # libp2p gossip broadcaster
├── dist/                 # Compiled TypeScript
└── bin/
    └── broadcast-vaa     # Compiled Go binary
```

## License

MIT
