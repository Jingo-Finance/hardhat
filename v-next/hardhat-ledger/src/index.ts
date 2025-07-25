import type { HardhatPlugin } from "hardhat/types/plugins";

import "./type-extensions.js";

import { PLUGIN_NAME } from "./internal/plugin-name.js";

const hardhatLedgerPlugin: HardhatPlugin = {
  id: PLUGIN_NAME,
  hookHandlers: {
    config: import.meta.resolve("./internal/hook-handlers/config.js"),
    network: import.meta.resolve("./internal/hook-handlers/network.js"),
  },
  npmPackage: "@nomicfoundation/hardhat-ledger",
};

export default hardhatLedgerPlugin;
