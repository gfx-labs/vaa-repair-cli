package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"time"

	"github.com/libp2p/go-libp2p"
	pubsub "github.com/libp2p/go-libp2p-pubsub"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multiaddr"
	"github.com/spf13/cobra"
)

// Network configurations
var networks = map[string]struct {
	NetworkID string
	Bootstrap []string
}{
	"mainnet": {
		NetworkID: "/wormhole/mainnet/2",
		Bootstrap: []string{
			"/dns4/wormhole-v2-mainnet-bootstrap.xlabs.xyz/udp/8999/quic-v1/p2p/12D3KooWNQ9tVrcb64tw6bNs2CaNrUGPM7yRrKvBBheQ5yCyPHKC",
			"/dns4/wormhole.mcf.rocks/udp/8999/quic-v1/p2p/12D3KooWDZVv7BhZ8yFLkarNdaSWaB43D6UbQwExJ8nnGAEmfHcU",
			"/dns4/wormhole-v2-mainnet-bootstrap.staking.fund/udp/8999/quic-v1/p2p/12D3KooWG8obDX9DNi1KUwZNu9xkGwfKqTp2GFwuuHpWZ3nQruS1",
		},
	},
	"testnet": {
		NetworkID: "/wormhole/testnet/2/1",
		Bootstrap: []string{
			"/dns4/wormhole-testnet-v2-bootstrap.xlabs.xyz/udp/8999/quic-v1/p2p/12D3KooWBY7LpL21yYLpge27as2TsrAGBB8VPF5hqK8e7r6xF9NM",
		},
	},
}

// encodeGossipMessage wraps VAA bytes in the Wormhole protobuf format
// Manual encoding to avoid proto dependency
func encodeGossipMessage(vaaBytes []byte) []byte {
	// SignedVAAWithQuorum: field 1 (vaa bytes)
	// Tag: (1 << 3) | 2 = 0x0a (field 1, wire type 2 = length-delimited)
	signedVaa := []byte{0x0a}
	signedVaa = append(signedVaa, encodeVarint(len(vaaBytes))...)
	signedVaa = append(signedVaa, vaaBytes...)

	// GossipMessage: field 4 (signed_vaa_with_quorum)
	// Tag: (4 << 3) | 2 = 0x22 (field 4, wire type 2)
	gossipMsg := []byte{0x22}
	gossipMsg = append(gossipMsg, encodeVarint(len(signedVaa))...)
	gossipMsg = append(gossipMsg, signedVaa...)

	return gossipMsg
}

func encodeVarint(n int) []byte {
	var buf []byte
	for n >= 0x80 {
		buf = append(buf, byte(n)|0x80)
		n >>= 7
	}
	buf = append(buf, byte(n))
	return buf
}

func broadcastVAA(vaaHex string, network string, timeout int) error {
	config, ok := networks[network]
	if !ok {
		return fmt.Errorf("unknown network: %s (use 'mainnet' or 'testnet')", network)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	// Decode VAA
	vaaBytes, err := hex.DecodeString(vaaHex)
	if err != nil {
		return fmt.Errorf("invalid VAA hex: %w", err)
	}

	fmt.Printf("VAA size: %d bytes\n", len(vaaBytes))

	// Generate ephemeral P2P key
	priv, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		return fmt.Errorf("failed to generate key: %w", err)
	}

	// Create libp2p host with QUIC v1 transport
	h, err := libp2p.New(
		libp2p.Identity(priv),
		libp2p.ListenAddrStrings(
			"/ip4/0.0.0.0/udp/0/quic-v1",
			"/ip4/0.0.0.0/tcp/0",
		),
	)
	if err != nil {
		return fmt.Errorf("failed to create host: %w", err)
	}
	defer h.Close()

	fmt.Printf("Local peer ID: %s\n", h.ID().String()[:16]+"...")

	// Connect to bootstrap peers
	fmt.Println("Connecting to bootstrap peers...")
	connectedPeers := 0
	for _, peerAddr := range config.Bootstrap {
		ma, err := multiaddr.NewMultiaddr(peerAddr)
		if err != nil {
			fmt.Printf("  Invalid multiaddr: %v\n", err)
			continue
		}

		peerInfo, err := peer.AddrInfoFromP2pAddr(ma)
		if err != nil {
			fmt.Printf("  Failed to parse peer info: %v\n", err)
			continue
		}

		if err := h.Connect(ctx, *peerInfo); err != nil {
			fmt.Printf("  Failed to connect to %s: %v\n", peerInfo.ID.String()[:12]+"...", err)
			continue
		}
		fmt.Printf("  Connected to %s\n", peerInfo.ID.String()[:12]+"...")
		connectedPeers++
	}

	if connectedPeers == 0 {
		return fmt.Errorf("failed to connect to any bootstrap peers")
	}

	// Create GossipSub instance
	ps, err := pubsub.NewGossipSub(ctx, h)
	if err != nil {
		return fmt.Errorf("failed to create GossipSub: %w", err)
	}

	// Join the broadcast topic
	topicName := config.NetworkID + "/broadcast"
	fmt.Printf("Joining topic: %s\n", topicName)

	topic, err := ps.Join(topicName)
	if err != nil {
		return fmt.Errorf("failed to join topic: %w", err)
	}
	defer topic.Close()

	// Wait for peers on the topic
	fmt.Println("Waiting for topic peers...")
	for i := 0; i < 30; i++ {
		peers := topic.ListPeers()
		if len(peers) > 0 {
			fmt.Printf("Found %d peers on topic\n", len(peers))
			break
		}
		if i == 29 {
			return fmt.Errorf("timeout waiting for topic peers")
		}
		time.Sleep(time.Second)
	}

	// Encode and publish
	gossipMsg := encodeGossipMessage(vaaBytes)
	fmt.Printf("Publishing message (%d bytes)...\n", len(gossipMsg))

	if err := topic.Publish(ctx, gossipMsg); err != nil {
		return fmt.Errorf("failed to publish: %w", err)
	}

	fmt.Println("VAA broadcast successfully!")

	// Wait for propagation
	fmt.Println("Waiting for propagation...")
	time.Sleep(5 * time.Second)

	return nil
}

func main() {
	var network string
	var timeout int

	rootCmd := &cobra.Command{
		Use:   "broadcast-vaa <vaa-hex>",
		Short: "Broadcast a VAA to the Wormhole gossip network",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return broadcastVAA(args[0], network, timeout)
		},
	}

	rootCmd.Flags().StringVar(&network, "network", "mainnet", "Network to broadcast on (mainnet or testnet)")
	rootCmd.Flags().IntVar(&timeout, "timeout", 60, "Connection timeout in seconds")

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
