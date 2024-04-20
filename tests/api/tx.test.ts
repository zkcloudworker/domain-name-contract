import { describe, expect, it } from "@jest/globals";
import { PrivateKey, PublicKey } from "o1js";
import { nameContract } from "../../src/config";
import { JWT } from "../../src/config";
import { zkCloudWorkerClient, sleep } from "zkcloudworker";

const ELEMENTS_NUMBER = 2;
const transactions: string[] = [];
const contractPublicKey = PublicKey.fromBase58(nameContract.contractAddress);

const api = new zkCloudWorkerClient({
  jwt: JWT,
  chain: "devnet",
});

type DomainTransactionType = "add" | "extend" | "update" | "remove";
interface Transaction {
  operation: DomainTransactionType;
  name: string;
  address: string;
  expiry: number;
  metadata?: string;
  oldDomain?: {
    name: string;
    address: string;
    expiry: number;
    metadata?: string;
  };
  signature?: string;
}

describe("Domain Name Service Contract", () => {
  it(`should prepare blocks data`, async () => {
    console.log("Preparing data...");
    console.time(`prepared data`);
    for (let i = 0; i < ELEMENTS_NUMBER; i++) {
      const tx: Transaction = {
        operation: "add",
        name: makeString(20),
        address: PrivateKey.random().toPublicKey().toBase58(),
        expiry: Date.now() + 1000 * 60 * 60 * 24 * 365,
      };
      transactions.push(JSON.stringify(tx, null, 2));
    }
    console.timeEnd(`prepared data`);
  });

  it.skip(`should add task to process transactions`, async () => {
    console.log(`Adding task to process transactions...`);
    console.time(`task added`);
    let args: string = JSON.stringify({
      contractAddress: contractPublicKey.toBase58(),
    });

    const result = await api.execute({
      repo: "nameservice",
      task: "createTxTask",
      transactions: [],
      args,
      developer: "@staketab",
      metadata: `txTask`,
      mode: "sync",
    });
    console.log(`task api call result:`, result);
    console.timeEnd(`task added`);
  });

  it(`should get blocks info`, async () => {
    console.log(`Getting blocks info...`);
    console.time(`block info received`);
    let args: string = JSON.stringify({
      contractAddress: contractPublicKey.toBase58(),
    });

    let result = await api.execute({
      repo: "nameservice",
      task: "getBlocksInfo",
      transactions: [],
      args,
      developer: "@staketab",
      metadata: `txTask`,
      mode: "sync",
    });

    console.timeEnd(`block info received`);
    console.log(`info api call result:`, result);
    let data = JSON.parse(result.result.result);
    console.log(`data:`, data);
    const startBlock = data[data.length - 1].previousBlockAddress;
    console.log(`startBlock:`, startBlock);

    console.time(`block info received`);
    args = JSON.stringify({
      contractAddress: contractPublicKey.toBase58(),
      startBlock,
    });

    result = await api.execute({
      repo: "nameservice",
      task: "getBlocksInfo",
      transactions: [],
      args,
      developer: "@staketab",
      metadata: `txTask`,
      mode: "sync",
    });

    console.timeEnd(`block info received`);
    data = JSON.parse(result.result.result);
    console.log(`data:`, data);
  });

  it.skip(`should create a block`, async () => {
    console.time(`Txs to the block sent`);
    const result = await api.sendTransactions({
      repo: "nameservice",
      developer: "@staketab",
      transactions,
    });
    console.log(`tx api call result:`, result);
    console.timeEnd(`Txs to the block sent`);
  });
});

function makeString(length: number): string {
  // eslint-disable-next-line @typescript-eslint/no-inferrable-types
  let outString: string = ``;
  // eslint-disable-next-line @typescript-eslint/no-inferrable-types
  const inOptions: string = `abcdefghijklmnopqrstuvwxyz`;

  for (let i = 0; i < length; i++) {
    outString += inOptions.charAt(Math.floor(Math.random() * inOptions.length));
  }

  return outString;
}
