// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { AquaOpcodes } from "@1inch/swap-vm/src/opcodes/AquaOpcodes.sol";
import { Controls } from "@1inch/swap-vm/src/instructions/Controls.sol";
import { Extruction } from "@1inch/swap-vm/src/instructions/Extruction.sol";
import { Program, ProgramBuilder } from "@1inch/swap-vm/test/utils/ProgramBuilder.sol";

import { VortexAquaOrderBuilder } from "../../src/aqua/VortexAquaOrderBuilder.sol";
import { VortexAquaPricing, VortexSwapConfig } from "../../src/aqua/VortexAquaPricing.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

/// @dev Inherits the official opcode set so the official test ProgramBuilder
///      can resolve real dispatch-table indices by function-pointer lookup.
contract OpcodeHarness is AquaOpcodes {
    using ProgramBuilder for Program;

    constructor() AquaOpcodes(address(0)) { }

    function deadlineOpcode() external pure returns (uint8) {
        return ProgramBuilder.findOpcode(ProgramBuilder.init(_opcodes()), Controls._deadline);
    }

    function saltOpcode() external pure returns (uint8) {
        return ProgramBuilder.findOpcode(ProgramBuilder.init(_opcodes()), Controls._salt);
    }

    function extructionOpcode() external pure returns (uint8) {
        return ProgramBuilder.findOpcode(ProgramBuilder.init(_opcodes()), Extruction._extruction);
    }

    function officialProgram(
        uint40 strategyDeadline,
        bytes memory extructionArgs,
        uint256 salt
    )
        external
        pure
        returns (bytes memory)
    {
        Program memory p = ProgramBuilder.init(_opcodes());
        return bytes.concat(
            p.build(Controls._deadline, abi.encodePacked(strategyDeadline)),
            p.build(Extruction._extruction, extructionArgs),
            p.build(Controls._salt, abi.encodePacked(salt))
        );
    }
}

/// @notice Pins VortexAquaOrderBuilder's hardcoded opcode indices to the
///         official v1.0.1 dispatch table. A dependency bump that reorders
///         the table fails HERE, not in production.
contract VortexProgramEncodingTest is Test {
    OpcodeHarness internal harness;
    VortexAquaOrderBuilder internal builder;
    VortexAquaPricing internal pricing;

    function setUp() public {
        harness = new OpcodeHarness();
        pricing = new VortexAquaPricing(address(this), IAqua(address(0)));
        builder = new VortexAquaOrderBuilder(pricing);
    }

    function test_programEncodingMatchesOfficialBuilder() public view {
        VortexSwapConfig memory cfg = VortexSwapConfig({
            baseToken: address(0xB000),
            quoteToken: address(0xC000),
            referenceOracle: address(0xD000),
            rebateSigner: address(0xE000),
            baseDecimals: 8,
            quoteDecimals: 6,
            minSafetyFeeBps: 5,
            defaultCommercialFeeBps: 20,
            minCommercialFeeBps: 5,
            maxCommercialFeeBps: 200,
            inventoryStrengthBps: 1_000,
            maxTradeBps: 1_000,
            minBaseWeightBps: 1_000,
            maxBaseWeightBps: 9_000,
            maxOracleSpreadBps: 50,
            maxOracleAge: 3_600
        });

        uint40 deadline = uint40(1_900_000_000);
        uint256 salt = 42;

        bytes memory mine = builder.buildProgram(deadline, cfg, salt);
        bytes memory official = harness.officialProgram(
            deadline,
            abi.encodePacked(address(pricing), VortexSwapConfigLibHarness.encode(cfg)),
            salt
        );

        assertEq(harness.deadlineOpcode(), 13, "deadline index drifted");
        assertEq(harness.saltOpcode(), 20, "salt index drifted");
        assertEq(harness.extructionOpcode(), 32, "extruction index drifted");
        assertEq(mine, official, "program bytes must match the official builder exactly");
    }
}

library VortexSwapConfigLibHarness {
    function encode(VortexSwapConfig memory c) internal pure returns (bytes memory) {
        return abi.encodePacked(
            c.baseToken,
            c.quoteToken,
            c.referenceOracle,
            c.rebateSigner,
            c.baseDecimals,
            c.quoteDecimals,
            c.minSafetyFeeBps,
            c.defaultCommercialFeeBps,
            c.minCommercialFeeBps,
            c.maxCommercialFeeBps,
            c.inventoryStrengthBps,
            c.maxTradeBps,
            c.minBaseWeightBps,
            c.maxBaseWeightBps,
            c.maxOracleSpreadBps,
            c.maxOracleAge
        );
    }
}
