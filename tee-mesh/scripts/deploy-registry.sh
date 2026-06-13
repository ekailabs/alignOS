#!/usr/bin/env bash
# Deploy AlignRegistry to Ethereum Sepolia. Needs a funded PRIVATE_KEY (Sepolia ETH).
#   PRIVATE_KEY=0x... bash scripts/deploy-registry.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FB="$HOME/.foundry/bin"
RPC="${REGISTRY_RPC:-https://ethereum-sepolia-rpc.publicnode.com}"
: "${PRIVATE_KEY:?set PRIVATE_KEY to a Sepolia-funded key}"

cd "$ROOT/contracts"
echo "deploying AlignRegistry to $RPC (chainId $($FB/cast chain-id --rpc-url "$RPC"))"
"$FB/forge" create src/AlignRegistry.sol:AlignRegistry \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --broadcast --json \
  | "$HOME/.deno/bin/deno" eval 'const d=JSON.parse(await new Response(Deno.stdin.readable).text());console.log("\nREGISTRY_CONTRACT="+d.deployedTo)'
