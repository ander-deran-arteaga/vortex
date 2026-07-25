// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { stdError } from "forge-std/StdError.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { MockERC20 } from "../../src/mocks/MockERC20.sol";

/// @notice Phase 1 exit gate: a real ERC-20 changes owner through the official
///         Aqua contract, and virtual balances track every move exactly.
contract AquaBaselineTest is Test {
    Aqua internal aqua;
    MockERC20 internal wbtc;
    MockERC20 internal usdc;

    address internal maker = makeAddr("maker");
    address internal app = makeAddr("app");
    address internal taker = makeAddr("taker");

    uint256 internal constant WBTC_SHIPPED = 1e8; // 1 WBTC
    uint256 internal constant USDC_SHIPPED = 100_000e6; // 100k USDC

    bytes internal strategy = abi.encode("vortex-best-execution-v1");
    bytes32 internal strategyHash;

    function setUp() public {
        aqua = new Aqua();
        wbtc = new MockERC20("Wrapped BTC", "WBTC", 8);
        usdc = new MockERC20("USD Coin", "USDC", 6);

        wbtc.mint(maker, 10e8);
        usdc.mint(maker, 1_000_000e6);

        strategyHash = keccak256(strategy);
    }

    function _ship() internal returns (bytes32 shippedHash) {
        address[] memory tokens = new address[](2);
        tokens[0] = address(wbtc);
        tokens[1] = address(usdc);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = WBTC_SHIPPED;
        amounts[1] = USDC_SHIPPED;

        vm.prank(maker);
        shippedHash = aqua.ship(app, strategy, tokens, amounts);
    }

    function _approveAqua() internal {
        vm.startPrank(maker);
        wbtc.approve(address(aqua), type(uint256).max);
        usdc.approve(address(aqua), type(uint256).max);
        vm.stopPrank();
    }

    function test_makerApprovesAqua() public {
        _approveAqua();
        assertEq(wbtc.allowance(maker, address(aqua)), type(uint256).max);
        assertEq(usdc.allowance(maker, address(aqua)), type(uint256).max);
    }

    function test_makerShipsStrategy() public {
        vm.expectEmit(address(aqua));
        emit IAqua.Shipped(maker, app, strategyHash, strategy);
        vm.expectEmit(address(aqua));
        emit IAqua.Pushed(maker, app, strategyHash, address(wbtc), WBTC_SHIPPED);
        vm.expectEmit(address(aqua));
        emit IAqua.Pushed(maker, app, strategyHash, address(usdc), USDC_SHIPPED);

        bytes32 shippedHash = _ship();

        assertEq(shippedHash, strategyHash);
        (uint256 balance0, uint256 balance1) =
            aqua.safeBalances(maker, app, strategyHash, address(wbtc), address(usdc));
        assertEq(balance0, WBTC_SHIPPED);
        assertEq(balance1, USDC_SHIPPED);
    }

    function test_shipDoesNotTransferTokens() public {
        uint256 makerWbtcBefore = wbtc.balanceOf(maker);
        uint256 makerUsdcBefore = usdc.balanceOf(maker);

        _ship();

        assertEq(wbtc.balanceOf(maker), makerWbtcBefore);
        assertEq(usdc.balanceOf(maker), makerUsdcBefore);
        assertEq(wbtc.balanceOf(address(aqua)), 0);
        assertEq(usdc.balanceOf(address(aqua)), 0);
    }

    function test_shipIsImmutable() public {
        _ship();

        address[] memory tokens = new address[](1);
        tokens[0] = address(wbtc);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 5e8;

        vm.prank(maker);
        vm.expectRevert(abi.encodeWithSelector(IAqua.StrategiesMustBeImmutable.selector, app, strategyHash));
        aqua.ship(app, strategy, tokens, amounts);
    }

    function test_pullTransfersRealToken() public {
        _approveAqua();
        _ship();

        uint256 makerWbtcBefore = wbtc.balanceOf(maker);
        uint256 pullAmount = 0.5e8;

        vm.expectEmit(address(aqua));
        emit IAqua.Pulled(maker, app, strategyHash, address(wbtc), pullAmount);

        vm.prank(app);
        aqua.pull(maker, strategyHash, address(wbtc), pullAmount, taker);

        // Real token ownership changed maker -> taker through official Aqua.
        assertEq(wbtc.balanceOf(taker), pullAmount);
        assertEq(wbtc.balanceOf(maker), makerWbtcBefore - pullAmount);

        (uint256 virtualWbtc,) = aqua.safeBalances(maker, app, strategyHash, address(wbtc), address(usdc));
        assertEq(virtualWbtc, WBTC_SHIPPED - pullAmount);
    }

    function test_pushReturnsRealToken() public {
        _approveAqua();
        _ship();

        uint256 pushAmount = 0.25e8;
        address pusher = makeAddr("pusher");
        wbtc.mint(pusher, pushAmount);

        uint256 makerWbtcBefore = wbtc.balanceOf(maker);

        vm.startPrank(pusher);
        wbtc.approve(address(aqua), pushAmount);
        vm.expectEmit(address(aqua));
        emit IAqua.Pushed(maker, app, strategyHash, address(wbtc), pushAmount);
        aqua.push(maker, app, strategyHash, address(wbtc), pushAmount);
        vm.stopPrank();

        // Real token moved pusher -> maker; virtual balance credited.
        assertEq(wbtc.balanceOf(maker), makerWbtcBefore + pushAmount);
        assertEq(wbtc.balanceOf(pusher), 0);

        (uint256 virtualWbtc,) = aqua.safeBalances(maker, app, strategyHash, address(wbtc), address(usdc));
        assertEq(virtualWbtc, WBTC_SHIPPED + pushAmount);
    }

    function test_virtualBalancesUpdate() public {
        _approveAqua();
        _ship();

        // Simulate one full best-execution fill: app pulls 0.5 WBTC to the
        // taker, taker pays 45k USDC back to the maker through push.
        uint256 wbtcOut = 0.5e8;
        uint256 usdcIn = 45_000e6;
        usdc.mint(taker, usdcIn);

        vm.prank(app);
        aqua.pull(maker, strategyHash, address(wbtc), wbtcOut, taker);

        vm.startPrank(taker);
        usdc.approve(address(aqua), usdcIn);
        aqua.push(maker, app, strategyHash, address(usdc), usdcIn);
        vm.stopPrank();

        (uint256 virtualWbtc, uint256 virtualUsdc) =
            aqua.safeBalances(maker, app, strategyHash, address(wbtc), address(usdc));
        assertEq(virtualWbtc, WBTC_SHIPPED - wbtcOut, "wbtc virtual decreases exactly by output");
        assertEq(virtualUsdc, USDC_SHIPPED + usdcIn, "usdc virtual increases exactly by input");

        // Aqua itself never holds inventory.
        assertEq(wbtc.balanceOf(address(aqua)), 0);
        assertEq(usdc.balanceOf(address(aqua)), 0);
    }

    function test_dockDeactivatesStrategy() public {
        _approveAqua();
        _ship();

        address[] memory tokens = new address[](2);
        tokens[0] = address(wbtc);
        tokens[1] = address(usdc);

        vm.expectEmit(address(aqua));
        emit IAqua.Docked(maker, app, strategyHash);
        vm.prank(maker);
        aqua.dock(app, strategyHash, tokens);

        // Docked strategies refuse reads, pushes, and pulls.
        vm.expectRevert(
            abi.encodeWithSelector(
                IAqua.SafeBalancesForTokenNotInActiveStrategy.selector, maker, app, strategyHash, address(wbtc)
            )
        );
        aqua.safeBalances(maker, app, strategyHash, address(wbtc), address(usdc));

        vm.prank(taker);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAqua.PushToNonActiveStrategyPrevented.selector, maker, app, strategyHash, address(wbtc)
            )
        );
        aqua.push(maker, app, strategyHash, address(wbtc), 1);

        vm.prank(app);
        vm.expectRevert(stdError.arithmeticError);
        aqua.pull(maker, strategyHash, address(wbtc), 1, taker);
    }

    function test_pullWithoutMakerApprovalReverts() public {
        _ship(); // no ERC20 approval to Aqua

        vm.prank(app);
        vm.expectRevert();
        aqua.pull(maker, strategyHash, address(wbtc), 1e8, taker);
    }

    function test_pullBeyondVirtualBalanceReverts() public {
        _approveAqua();
        _ship();

        // Maker holds 10 WBTC and approved max, but the strategy only shipped 1.
        vm.prank(app);
        vm.expectRevert(stdError.arithmeticError);
        aqua.pull(maker, strategyHash, address(wbtc), WBTC_SHIPPED + 1, taker);
    }

    function test_pullByOtherAppReverts() public {
        _approveAqua();
        _ship();

        // A different msg.sender has no virtual balance under this strategy.
        vm.prank(makeAddr("mallory"));
        vm.expectRevert(stdError.arithmeticError);
        aqua.pull(maker, strategyHash, address(wbtc), 1, taker);
    }
}
