import * as bitcoinJS from "bitcoinjs-lib";
import dotenv from "dotenv";
import { fetchSecrets } from "./utilities/secretManager";
import { logger } from "./utilities/logger"
import { WalletCredsVersion } from "./interfaces/wallet";

const result = dotenv.config();

if (result.error && process.env.LOCAL_DEV !== "true") {
  throw result.error;
}

export enum SERVER_TYPE {
  MAIN = "MAIN",
  TEST = "TEST"
}

export enum DATABASE_TYPE {
  DEV = "DEV",
  PROD = "PROD"
}

class Config {
  public LOCAL_DEV = process.env.LOCAL_DEV === "true";
  public ENVIRONMENT: string = process.env.ENVIRONMENT;
  public PORT: string = process.env.PORT || "3003";
  public NETWORK: bitcoinJS.Network;
  public HEXA_ID = process.env.HEXA_ID
  public RELAY = process.env.RELAY

  public INHERITANCE_KEY_REQUEST_THRESHOLD: number; // 30days(prod) / 5 mins(dev)
  public INHERITANCE_KEY_REQUEST_TTL: number;       // 3x of request threshold duration
  public ADMIN_KEY: string = process.env.BIT_ADMIN_KEY;
  public VERSION: string = process.env.VERSION;

  public MAILER_CONFIG = {
    SES_REGION: process.env.SES_REGION,
    SOURCE_EMAIL: process.env.SES_SOURCE_EMAIL,
    ACCESS_KEY_ID: process.env.SES_ACCESS_KEY_ID,
    SECRET_ACCESS_KEY: process.env.SES_SECRET_ACCESS_KEY,
  }

  public DB_MODE = process.env.DB_MODE;
  public DATABASE_NAME_V2: string = process.env.DATABASE_NAME_V2;
  public DATABASE_SECRET_IDENTIFIER_V2: string = process.env.DATABASE_SECRET_IDENTIFIER_V2;
  public PROJECT_ID: string = process.env.PROJECT_ID;
  public MIN_POLICY_UPDATE_DELAY: number;

  public MNEMONIC_IDENTIFIERS = {
    [WalletCredsVersion.V2]: process.env.MNEMONIC_IDENTIFIER_V2,
    [WalletCredsVersion.V3]: process.env.MNEMONIC_IDENTIFIER_V3,
  };

  public INHERITANCE_MNEMONIC_IDENTIFIERS = {
    [WalletCredsVersion.V2]: process.env.INHERITANCE_MNEMONIC_IDENTIFIER_V2,
    [WalletCredsVersion.V3]: process.env.INHERITANCE_MNEMONIC_IDENTIFIER_V3,
  };

  public RSA_PRV_KEY_IDENTIFIER: string = process.env.RSA_PRV_KEY_IDENTIFIER;
  public RSA_PUB_KEY_IDENTIFIER: string = process.env.RSA_PUB_KEY_IDENTIFIER;
  public RSA_PRV_KEY: string;
  public RSA_PUB_KEY: string;

  constructor() {
    if (this.LOCAL_DEV) {
      const db = new URL(process.env.LOCAL_DATABASE_URL || "");
      if (this.ENVIRONMENT !== "TEST" || this.DB_MODE !== "DEV" ||
          db.protocol !== "mongodb:" || !["mongo", "localhost", "127.0.0.1"].includes(db.hostname) ||
          db.username || db.password || db.pathname !== "/keeper_signing_local") {
        throw new Error("Local signing requires TEST, DEV and the isolated local database");
      }
      if (this.HEXA_ID !== "keeper-local-only") throw new Error("Local signing requires its own application credential");
    }
    this.configureNetwork();
  }

  public configureNetwork = () => {
    if (this.ENVIRONMENT === SERVER_TYPE.MAIN) {
      this.NETWORK = bitcoinJS.networks.bitcoin;
      this.INHERITANCE_KEY_REQUEST_THRESHOLD = 2592000000 // 30 days in milliseconds
      this.MIN_POLICY_UPDATE_DELAY = 1 * 7 * 24 * 60 * 60 * 1000 // 1 week in milliseconds
    } else if (this.ENVIRONMENT === SERVER_TYPE.TEST) {
      this.NETWORK = bitcoinJS.networks.testnet;
      this.INHERITANCE_KEY_REQUEST_THRESHOLD = 300000     // 5 mins in milliseconds
      this.MIN_POLICY_UPDATE_DELAY = 1 * 60 * 60 * 1000 // 1 hour in milliseconds
    } else {
      throw new Error("Please specify an apt environment(MAIN||TEST)");
    }
    this.INHERITANCE_KEY_REQUEST_TTL = (this.INHERITANCE_KEY_REQUEST_THRESHOLD / 1000) * 3
  };

  public initRSAKeys = async () => {
    const [privResponse, pubResponse] = await fetchSecrets([this.RSA_PRV_KEY_IDENTIFIER, this.RSA_PUB_KEY_IDENTIFIER]);
    this.RSA_PRV_KEY = privResponse[this.RSA_PRV_KEY_IDENTIFIER]
    this.RSA_PUB_KEY = pubResponse[this.RSA_PUB_KEY_IDENTIFIER]
    logger.info('RSA keys have been initialized')
  }
}

export default new Config();
