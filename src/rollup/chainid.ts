import { Field } from "o1js";

// TODO: move to the zkCloudWorker library
export const chainId = {
  mainnet: Field(1),
  testnet: Field(2),
  berkeley: Field(3),
  lightnet: Field(4),
  zeko: Field(5),
  local: Field(6),
  protokit: Field(7),
};
