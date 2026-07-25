import { vi } from "vitest";

/**
 * Wallet state the tests drive. wagmi is mocked rather than run against a real
 * connector so rejection paths (user declines an approval, wrong network) are
 * reachable deterministically.
 */
export interface WalletScenario {
  address?: `0x${string}`;
  chainId?: number;
  chainName?: string;
  isConnected: boolean;
  switchPending?: boolean;
  writeError?: Error | null;
}

export const walletState: { current: WalletScenario } = {
  current: { isConnected: false },
};

export const switchChainSpy = vi.fn();
export const writeContractAsyncSpy = vi.fn();
export const sendTransactionAsyncSpy = vi.fn();
export const readContractSpy = vi.fn();
export const callSpy = vi.fn();
export const waitForReceiptSpy = vi.fn();

export function setWallet(scenario: WalletScenario) {
  walletState.current = scenario;
}

export function resetWallet() {
  walletState.current = { isConnected: false };
  switchChainSpy.mockReset();
  writeContractAsyncSpy.mockReset();
  sendTransactionAsyncSpy.mockReset();
  readContractSpy.mockReset();
  callSpy.mockReset();
  waitForReceiptSpy.mockReset();
}

/** Chain object shaped like wagmi's: undefined when the chain is unsupported. */
function currentChain() {
  const { chainId, chainName } = walletState.current;
  if (chainId === undefined) {
    return undefined;
  }
  return { id: chainId, name: chainName ?? `Chain ${chainId}` };
}

export const wagmiMock = {
  useAccount: () => ({
    address: walletState.current.address,
    chain: currentChain(),
    isConnected: walletState.current.isConnected,
  }),
  useSwitchChain: () => ({
    switchChain: switchChainSpy,
    isPending: walletState.current.switchPending ?? false,
  }),
  useWriteContract: () => ({
    writeContractAsync: writeContractAsyncSpy,
    isPending: false,
    error: walletState.current.writeError ?? null,
    reset: vi.fn(),
  }),
  useWaitForTransactionReceipt: () => ({
    isSuccess: false,
    isLoading: false,
    data: undefined,
  }),
  useSendTransaction: () => ({
    sendTransactionAsync: sendTransactionAsyncSpy,
    isPending: false,
  }),
  // A public client only exists once a wallet is connected in these tests, so
  // an execution attempt without one degrades rather than throwing.
  usePublicClient: () =>
    walletState.current.isConnected
      ? {
          readContract: readContractSpy,
          call: callSpy,
          waitForTransactionReceipt: waitForReceiptSpy,
        }
      : undefined,
};
