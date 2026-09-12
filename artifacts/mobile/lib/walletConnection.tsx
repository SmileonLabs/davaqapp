import AsyncStorage from "@react-native-async-storage/async-storage";
import { EthersAdapter } from "@reown/appkit-ethers-react-native";
import {
  AppKit,
  AppKitProvider,
  createAppKit,
  useAccount,
  useAppKit,
  useProvider,
  type AppKitNetwork,
} from "@reown/appkit-react-native";
import React, { createContext, useContext, useMemo, useState } from "react";
import { Platform } from "react-native";

const BNB_CHAIN: AppKitNetwork = {
  id: 56,
  caipNetworkId: "eip155:56",
  chainNamespace: "eip155",
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-dataseed.bnbchain.org"] } },
  blockExplorers: { default: { name: "BscScan", url: "https://bscscan.com" } },
};

const projectId = process.env.EXPO_PUBLIC_REOWN_PROJECT_ID?.trim() ?? "";
const appKitStorage = {
  async getKeys() {
    return Array.from(await AsyncStorage.getAllKeys());
  },
  async getEntries<T>() {
    const entries = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
    return entries
      .filter((entry): entry is [string, string] => entry[1] != null)
      .map(([key, value]) => {
        try {
          return [key, JSON.parse(value) as T] as [string, T];
        } catch {
          return [key, value as T] as [string, T];
        }
      });
  },
  async getItem<T>(key: string) {
    const value = await AsyncStorage.getItem(key);
    if (value == null) return undefined;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  },
  setItem<T>(key: string, value: T) {
    return AsyncStorage.setItem(key, JSON.stringify(value));
  },
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};

const appKit = projectId
  ? createAppKit({
      projectId,
      adapters: [new EthersAdapter()],
      networks: [BNB_CHAIN],
      defaultNetwork: BNB_CHAIN,
      storage: appKitStorage,
      metadata: {
        name: "DavaQ",
        description: "DavaQ STAR NFT wallet verification",
        url: "https://davaq.anothermeai.app",
        icons: ["https://davaq.anothermeai.app/favicon.ico"],
        redirect: {
          native: "anotherme://wallet",
          universal: "https://davaq.anothermeai.app/app",
        },
      },
      enableAnalytics: false,
      features: { swaps: false, onramp: false },
      themeMode: "dark",
      themeVariables: { accent: "#8B5CF6" },
    })
  : null;

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface WalletConnectionValue {
  address: string | null;
  chainId: number | null;
  isConnected: boolean;
  isBusy: boolean;
  automaticConnectionAvailable: boolean;
  connect(): Promise<string>;
  signMessage(message: string, address?: string): Promise<string>;
  disconnect(): Promise<void>;
}

const WalletConnectionContext = createContext<WalletConnectionValue | null>(null);

function parseChainId(value: string | number | undefined): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (!value) return null;
  const last = value.includes(":") ? value.split(":").at(-1)! : value;
  const parsed = Number.parseInt(last, last.startsWith("0x") ? 16 : 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function injectedProvider(): Eip1193Provider | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  return ((window as unknown as { ethereum?: Eip1193Provider }).ethereum ?? null);
}

function ReownBridge({ children }: { children: React.ReactNode }) {
  const account = useAccount();
  const { provider } = useProvider();
  const { open, disconnect: disconnectAppKit } = useAppKit();
  const [isBusy, setIsBusy] = useState(false);

  const value = useMemo<WalletConnectionValue>(
    () => ({
      address: account.address ?? null,
      chainId: parseChainId(account.chainId),
      isConnected: account.isConnected,
      isBusy,
      automaticConnectionAvailable: true,
      async connect() {
        if (account.address) return account.address;
        open({ view: "Connect" });
        throw new Error("wallet_connection_pending");
      },
      async signMessage(message, requestedAddress) {
        if (!provider) throw new Error("wallet_not_connected");
        setIsBusy(true);
        try {
          const address = requestedAddress ?? account.address;
          if (!address) throw new Error("wallet_not_connected");
          const signature = await provider.request({
            method: "personal_sign",
            params: [message, address],
          });
          if (typeof signature !== "string") throw new Error("invalid_wallet_signature");
          return signature;
        } finally {
          setIsBusy(false);
        }
      },
      async disconnect() {
        disconnectAppKit("eip155");
      },
    }),
    [account.address, account.chainId, account.isConnected, disconnectAppKit, isBusy, open, provider],
  );

  return (
    <WalletConnectionContext.Provider value={value}>
      {children}
      <AppKit />
    </WalletConnectionContext.Provider>
  );
}

function InjectedBridge({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const provider = injectedProvider();

  const value = useMemo<WalletConnectionValue>(
    () => ({
      address,
      chainId,
      isConnected: Boolean(address),
      isBusy,
      automaticConnectionAvailable: provider != null,
      async connect() {
        if (!provider) throw new Error("wallet_app_required");
        setIsBusy(true);
        try {
          const accounts = await provider.request({ method: "eth_requestAccounts" });
          const nextAddress = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
          if (!nextAddress) throw new Error("wallet_not_connected");
          const rawChainId = await provider.request({ method: "eth_chainId" });
          setAddress(nextAddress);
          setChainId(typeof rawChainId === "string" ? parseChainId(rawChainId) : null);
          return nextAddress;
        } finally {
          setIsBusy(false);
        }
      },
      async signMessage(message, requestedAddress) {
        if (!provider) throw new Error("wallet_app_required");
        const signer = requestedAddress ?? address;
        if (!signer) throw new Error("wallet_not_connected");
        setIsBusy(true);
        try {
          const signature = await provider.request({
            method: "personal_sign",
            params: [message, signer],
          });
          if (typeof signature !== "string") throw new Error("invalid_wallet_signature");
          return signature;
        } finally {
          setIsBusy(false);
        }
      },
      async disconnect() {
        setAddress(null);
        setChainId(null);
      },
    }),
    [address, chainId, isBusy, provider],
  );

  return <WalletConnectionContext.Provider value={value}>{children}</WalletConnectionContext.Provider>;
}

export function WalletConnectionProvider({ children }: { children: React.ReactNode }) {
  if (!appKit) return <InjectedBridge>{children}</InjectedBridge>;
  return (
    <AppKitProvider instance={appKit}>
      <ReownBridge>{children}</ReownBridge>
    </AppKitProvider>
  );
}

export function useWalletConnection() {
  const context = useContext(WalletConnectionContext);
  if (!context) throw new Error("useWalletConnection must be used inside WalletConnectionProvider");
  return context;
}
