import * as bitcoinJS from "bitcoinjs-lib";
import dotenv from "dotenv";
const result = dotenv.config();

if (result.error && process.env.LOCAL_DEV !== "true") {
  throw result.error;
}

export enum SERVER_ENVIRONMENT {
  DEVELOPMENT = "DEVELOPMENT",
  STAGING = "STAGING",
  PRODUCTION = "PRODUCTION",
}

export enum BITCOIN_NETWORK {
  TESTNET = "TESTNET",
  MAINNET = "MAINNET",
}

export enum OS {
  ANDROID = "android",
  iOS = "ios",
  DESKTOP = "desktop", // for desktop based subscriptions
}

class Config {
  public LOCAL_DEV = process.env.LOCAL_DEV === "true";
  public ENVIRONMENT: SERVER_ENVIRONMENT = process.env
    .ENVIRONMENT as SERVER_ENVIRONMENT;
  public PORT: string = process.env.PORT || "3000";
  public WS_PORT: string = process.env.WS_PORT || "4002";
  public VERSION: string = process.env.VERSION;
  public NETWORK: bitcoinJS.Network;
  public ADMIN_KEY: string = process.env.ADMIN_KEY;
  public HEXA_ID = process.env.HEXA_ID;

  public DATABASE: string = process.env.DATABASE_URL;
  public FIREBASE_DB_URL = process.env.FIREBASE_DB_URL;
  public GOOGLE_SERVICE_ACCOUNT_EMAIL =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  public GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY =
    (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/gm, "\n");
  public APPLE_SHARED_SECRET = process.env.APPLE_SHARED_SECRET;
  public FAUCET_MNEMONIC = process.env.FAUCET_MNEMONIC;
  public MOCK_PURCHASE_IDENTIFIER = "keeper-dev-mock-purchase";
  public HODLER_SKU = {
    [SERVER_ENVIRONMENT.DEVELOPMENT]: {
      [OS.ANDROID]: ["hodler.dev"],
      [OS.iOS]: ["hodler.monthly", "hodler.yearly"],
    },
    [SERVER_ENVIRONMENT.PRODUCTION]: {
      [OS.ANDROID]: ["hodler"],
      [OS.iOS]: ["hodler_monthly", "hodler_yearly"],
    },
  };
  public HODLER_SKU_NEW = {
    [SERVER_ENVIRONMENT.DEVELOPMENT]: {
      [OS.ANDROID]: ["hodler.monthly", "hodler.yearly"],
      [OS.iOS]: ["hodler.monthly", "hodler.yearly"],
      [OS.DESKTOP]: ["hodler.yearly"],
    },
    [SERVER_ENVIRONMENT.PRODUCTION]: {
      [OS.ANDROID]: ["hodler.monthly", "hodler.yearly"],
      [OS.iOS]: ["hodler_monthly", "hodler_yearly"],
      [OS.DESKTOP]: ["hodler.yearly"],
    },
  };

  public DIAMOND_HANDS_SKU = {
    [SERVER_ENVIRONMENT.DEVELOPMENT]: {
      [OS.ANDROID]: ["diamond_hands.dev"],
      [OS.iOS]: ["diamond_hands.monthly", "diamond_hands.yearly"],
    },
    [SERVER_ENVIRONMENT.PRODUCTION]: {
      [OS.ANDROID]: ["diamond_hands"],
      [OS.iOS]: ["diamond_hands_monthly", "diamond_hands_yearly"],
    },
  };
  public DIAMOND_HANDS_SKU_NEW = {
    [SERVER_ENVIRONMENT.DEVELOPMENT]: {
      [OS.ANDROID]: ["diamond_hands.monthly", "diamond_hands.yearly"],
      [OS.iOS]: ["diamond_hands.monthly", "diamond_hands.yearly"],
      [OS.DESKTOP]: ["diamond_hands.yearly"],
    },
    [SERVER_ENVIRONMENT.PRODUCTION]: {
      [OS.ANDROID]: ["diamond_hands.monthly", "diamond_hands.yearly"],
      [OS.iOS]: ["diamond_hands_monthly", "diamond_hands_yearly"],
      [OS.DESKTOP]: ["diamond_hands.yearly"],
    },
  };

  public KEEPER_PRIVATE_SKU = ["keeper_private_yearly"];

  public APPSTORE_KEY = process.env.APPSTORE_PRIVATE_KEY || "";
  public APPSTORE_KEY_ID = "H47BXD8H3V";

  public BTC_PAY_STORE_ID = process.env.BTC_PAY_STORE_ID;
  public BTC_PAY_API_TOKEN = process.env.BTC_PAY_API_TOKEN;
  public CHANNEL_URL = process.env.CHANNEL_URL;
  public BTC_PAY_SERVER_URL = process.env.BTC_PAY_SERVER_URL;
  public LETS_EXCHANGE_BASE_URL = process.env.LETS_EXCHANGE_BASE_URL;
  public LETS_EXCHANGE_API_KEY = process.env.LETS_EXCHANGE_API_KEY;
  public LETS_EXCHANGE_AFFILIATE_ID = process.env.LETS_EXCHANGE_AFFILIATE_ID;
  public ZENDESK_ENABLED = false; // Hardcoded kill switch for Zendesk integration. Flip to true to re-enable.
  public ZENDESK_USERNAME = process.env.ZENDESK_USERNAME;
  public ZENDESK_PASSWORD = process.env.ZENDESK_PASSWORD;
  public ZENDESK_BASE_URL = process.env.ZENDESK_BASE_URL;
  public RAMP_PRIVATE_KEY = (process.env.RAMP_PRIVATE_KEY || "").replace(/\\n/gm, "\n");
  public RAMP_HOST_API_KEY = process.env.RAMP_HOST_API_KEY;

  constructor(env: string) {
    if (this.LOCAL_DEV) {
      const allowedHosts = ["mongo", "localhost", "127.0.0.1"];
      const databaseHost = new URL(this.DATABASE).hostname;
      if (this.ENVIRONMENT !== SERVER_ENVIRONMENT.DEVELOPMENT || env !== BITCOIN_NETWORK.TESTNET || !allowedHosts.includes(databaseHost)) {
        throw new Error("LOCAL_DEV requires DEVELOPMENT, TESTNET and a local MongoDB database");
      }
    }
    this.NETWORK =
      env.trim() === BITCOIN_NETWORK.MAINNET
        ? bitcoinJS.networks.bitcoin
        : bitcoinJS.networks.testnet;
  }
}

export default new Config(process.env.BITCOIN_NETWORK);
