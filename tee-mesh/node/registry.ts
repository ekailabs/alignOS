// On-chain membership: each node self-registers (node_id, pubkey, codeId, gatewayUrl) at
// boot, so the contract IS the seed list — no hand-edited peer file, no deploy-order coupling.
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ABI = [
  { type: "function", name: "register", stateMutability: "nonpayable",
    inputs: [{ name: "nodeId", type: "bytes32" }, { name: "pubkey", type: "bytes" },
             { name: "codeId", type: "bytes32" }, { name: "gatewayUrl", type: "string" }], outputs: [] },
  { type: "function", name: "getMembers", stateMutability: "view", inputs: [],
    outputs: [{ type: "bytes32[]" }] },
  { type: "function", name: "getMember", stateMutability: "view", inputs: [{ name: "nodeId", type: "bytes32" }],
    outputs: [{ type: "tuple", components: [
      { name: "pubkey", type: "bytes" }, { name: "codeId", type: "bytes32" },
      { name: "gatewayUrl", type: "string" }, { name: "registeredAt", type: "uint256" }] }] },
] as const;

export interface RegistryClient {
  register: (nodeId: Hex, pubkey: Hex, codeId: Hex, gatewayUrl: string) => Promise<Hex>;
  members: () => Promise<{ node_id: Hex; gateway_url: string }[]>;
}

export function makeRegistry(rpc: string, contract: Address, privateKey: Hex): RegistryClient {
  const account = privateKeyToAccount(privateKey);
  const pub = createPublicClient({ transport: http(rpc) });
  const wallet = createWalletClient({ account, transport: http(rpc) });
  let chain: ReturnType<typeof defineChain> | null = null;
  const ensureChain = async () => (chain ??= defineChain({
    id: await pub.getChainId(), name: "align",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  }));
  return {
    async register(nodeId, pubkey, codeId, gatewayUrl) {
      const hash = await wallet.writeContract({
        address: contract, abi: ABI, functionName: "register",
        args: [nodeId, pubkey, codeId, gatewayUrl], chain: await ensureChain(),
      });
      await pub.waitForTransactionReceipt({ hash });
      return hash;
    },
    async members() {
      const ids = await pub.readContract({ address: contract, abi: ABI, functionName: "getMembers" }) as Hex[];
      const out: { node_id: Hex; gateway_url: string }[] = [];
      for (const id of ids) {
        const m = await pub.readContract({ address: contract, abi: ABI, functionName: "getMember", args: [id] }) as any;
        out.push({ node_id: id, gateway_url: m.gatewayUrl });
      }
      return out;
    },
  };
}
