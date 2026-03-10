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
npm install
npm run build:all
```

## Quick Start

```bash
# Assemble and broadcast a VAA
npx vaa-repair assemble 22/00000000000000000000000000000000000000000000000000000000000008b3/31 --broadcast
```

## Usage

### Assemble a VAA

```bash
# Basic assembly (outputs hex)
npx vaa-repair assemble 21/ccceeb29348f71bdd22ffef43a2a19c1f5b5e17c5cca5411529120182672ade5/222340

# With broadcast
npx vaa-repair assemble 22/emitter/sequence --broadcast

# Output as base64
npx vaa-repair assemble 2/emitter/sequence --output base64

# Use specific guardian set (for older VAAs)
npx vaa-repair assemble 22/emitter/sequence --guardian-set 4

# Custom RPC endpoint
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

### List available guardian sets

```bash
npx vaa-repair guardian-sets
```

## Guardian Sets

The tool fetches guardian sets from the [Wormhole repository](https://github.com/wormhole-foundation/wormhole/tree/main/guardianset/mainnetv2) at startup. All 5 mainnet guardian sets (v1-v5) are available.

Use `--guardian-set` to specify which set to use for older VAAs:

| Set | Active Period |
|-----|---------------|
| v1 | Aug 2021 - May 2022 |
| v2 | May 2022 - Jan 2023 |
| v3 | Jan 2023 - Apr 2024 |
| v4 | Apr 2024 - Mar 2026 |
| v5 | Mar 2026 - present (default) |

Observations from guardians not in the selected set are automatically filtered out.

## Supported Chains

| Family | Chain | ID | Notes |
|--------|-------|-----|-------|
| Solana | Solana | 1 | Parses Posted Message accounts |
| Sui | Sui | 21 | Queries WormholeMessage events |
| Aptos | Aptos | 22 | Queries WormholeMessage events |
| EVM | Ethereum | 2 | Built-in RPC |
| EVM | BSC | 4 | Built-in RPC |
| EVM | Polygon | 5 | Built-in RPC |
| EVM | Avalanche | 6 | Built-in RPC |
| EVM | Arbitrum | 23 | Built-in RPC |
| EVM | Optimism | 24 | Built-in RPC |
| EVM | Base | 30 | Built-in RPC |
| EVM | HyperEVM | 47 | Built-in RPC |

Other EVM chains work with the `--rpc` flag.

### Not Supported

- CosmWasm chains (Terra2, Injective, Sei, etc.)
- Near
- Algorand

## Options

### `assemble`

| Option | Description | Default |
|--------|-------------|---------|
| `<vaa-id>` | VAA ID: `chainId/emitter/sequence` | required |
| `--rpc <url>` | Custom RPC endpoint | chain default |
| `--output <format>` | `hex` or `base64` | `hex` |
| `--broadcast` | Broadcast after assembly | false |
| `--network <net>` | `mainnet` or `testnet` | `mainnet` |
| `--guardian-set <n>` | Guardian set version | `5` |

### `broadcast`

| Option | Description | Default |
|--------|-------------|---------|
| `--vaa <hex>` | VAA in hex format | required |
| `--network <net>` | `mainnet` or `testnet` | `mainnet` |
| `--timeout <seconds>` | Connection timeout | `60` |

## How it works

### VAA Assembly

1. Fetches guardian observations from Wormholescan API
2. Filters observations to match selected guardian set
3. Fetches message data from source chain:
   - **Solana**: Posted Message account
   - **Sui**: WormholeMessage event via JSON-RPC
   - **Aptos**: WormholeMessage event via REST API
   - **EVM**: LogMessagePublished event from transaction receipt
4. Verifies quorum (13 of 19 signatures)
5. Assembles VAA with sorted signatures

### Gossip Broadcast

1. Connects to Wormhole bootstrap peers via libp2p (QUIC)
2. Publishes to `/wormhole/mainnet/2/broadcast` topic
3. VAA wrapped in `SignedVAAWithQuorum` protobuf format

## Troubleshooting

### "Insufficient observations"

Not enough guardian signatures. Wait for more guardians to observe, or check the VAA ID.

### "broadcast-vaa binary not found"

Run `npm run build:go`. Requires Go 1.21+.

### "No RPC endpoint available"

Use `--rpc` to specify an endpoint for chains without built-in defaults.

### "X from non-vN guardians, skipped"

Normal behavior. Observations from guardians not in your selected set are filtered.

## Development

```bash
npm run dev -- assemble 22/emitter/31   # Run without building
npm run build                            # Build TypeScript only
npm run build:go                         # Build Go binary only
npm run build:all                        # Build everything
```

## Project Structure

```
src/
├── index.ts        # CLI entry point
├── assemble.ts     # VAA assembly logic
├── guardians.ts    # Guardian set fetching/management
├── solana.ts       # Solana message fetching
├── sui.ts          # Sui message fetching
├── aptos.ts        # Aptos message fetching
├── broadcast.ts    # Go binary wrapper
├── observations.ts # Wormholescan API client
└── utils.ts        # Encoding helpers, chain config

broadcast/
└── main.go         # libp2p gossip broadcaster
```

## License

MIT
