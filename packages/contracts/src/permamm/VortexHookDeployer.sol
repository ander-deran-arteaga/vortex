// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { VortexHook } from "./VortexHook.sol";

/// @notice Deploys VortexHook with CREATE2 so it lands on an address whose low
///         bits encode its callback permissions — v4 reads a hook's rights from
///         its ADDRESS, so the salt is not cosmetic.
/// @dev The salt is mined offchain (see script/DeployPermAMM.s.sol); this
///      contract only performs the deployment and asserts the result.
contract VortexHookDeployer {
    error VortexHookAddressMismatch(address deployed, address expected);

    event VortexHookDeployed(address hook, bytes32 salt);

    function deploy(
        VortexHook.HookConfig memory config,
        bytes32 salt,
        address expected
    )
        external
        returns (VortexHook hook)
    {
        hook = new VortexHook{ salt: salt }(config);
        require(address(hook) == expected, VortexHookAddressMismatch(address(hook), expected));
        emit VortexHookDeployed(address(hook), salt);
    }

    /// @notice Address a given salt would produce, for offchain salt mining.
    function computeAddress(
        VortexHook.HookConfig memory config,
        bytes32 salt
    )
        external
        view
        returns (address)
    {
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(VortexHook).creationCode, abi.encode(config)));
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))))
        );
    }
}
