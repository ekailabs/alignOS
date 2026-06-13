// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Minimal membership registry for an alignOS CVM mesh.
/// Stores, per node, the crypto identity AND the gateway URL — the latter is the
/// thing TEEBridge/ERC-733 omits, and the reason peers can actually dial each other.
/// Trusted PoC: register() is open. HARDENING: gate it behind an IVerifier the way
/// tee-interop's TEEBridge.register does, so only attested CVMs can join.
contract AlignRegistry {
    struct CVM {
        bytes pubkey;
        bytes32 codeId;
        string gatewayUrl;
        uint256 registeredAt;
    }

    mapping(bytes32 => CVM) internal _members;
    bytes32[] internal _ids;
    mapping(bytes32 => bool) internal _known;

    event Registered(bytes32 indexed nodeId, string gatewayUrl);

    function register(bytes32 nodeId, bytes calldata pubkey, bytes32 codeId, string calldata gatewayUrl) external {
        if (!_known[nodeId]) {
            _known[nodeId] = true;
            _ids.push(nodeId);
        }
        _members[nodeId] = CVM(pubkey, codeId, gatewayUrl, block.timestamp);
        emit Registered(nodeId, gatewayUrl);
    }

    function getMembers() external view returns (bytes32[] memory) {
        return _ids;
    }

    function getMember(bytes32 nodeId) external view returns (CVM memory) {
        return _members[nodeId];
    }
}
