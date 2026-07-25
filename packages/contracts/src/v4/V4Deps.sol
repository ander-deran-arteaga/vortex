// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Uniswap v4-core's PoolManager is `pragma solidity 0.8.26` exact, while every
// Vortex contract is 0.8.30 (aqua and swap-vm require it). Solidity resolves one
// compiler version per compilation unit — a file plus all of its transitive
// imports — so no 0.8.30 file can ever import PoolManager.
//
// This file exists solely to pull v4-core into the build as its OWN 0.8.26
// compilation unit, so that the PoolManager artifact is produced. Tests then
// instantiate it by artifact rather than by type:
//
//     address pm = deployCode("PoolManager.sol:PoolManager", abi.encode(owner));
//     IPoolManager(pm)...
//
// WARNING: nothing compiled at 0.8.30 may import this file. Doing so merges the
// two compilation units and breaks the build with an incompatible-version error.
// See docs/dependencies.md for the full rationale.
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";

contract V4Deps { }
