import { describe, expect, it } from "@jest/globals";
import { PrivateKey } from "o1js";
import axios from "axios";
import { nameContract } from "../../src/config";
import { uniqueNamesGenerator, names } from "unique-names-generator";

const ELEMENTS_NUMBER = 2;
const transactions: string[] = [];
const contractAddress = nameContract.contractAddress;

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

describe("Domain Name Service API", () => {
  it(`should prepare transactions data`, async () => {
    console.log("Preparing data...");
    console.time(`prepared data`);
    for (let i = 0; i < ELEMENTS_NUMBER; i++) {
      const tx: Transaction = {
        operation: "add",
        name: uniqueNamesGenerator({
          dictionaries: [names],
          length: 1,
        }).toLowerCase(),
        address: PrivateKey.random().toPublicKey().toBase58(), // "B62..."
        expiry: Date.now() + 1000 * 60 * 60 * 24 * 365, // one year
      };
      transactions.push(JSON.stringify(tx, null, 2));
    }
    console.timeEnd(`prepared data`);
  });

  it.skip(`should add task to process transactions`, async () => {
    console.log(`Adding task to process transactions...`);
    /*
      adding task to process transactions
      New transactions are processed in the backend by the zkCloudWorker every 10 minutes
      for 4 hours, then the task is deleted
      */
    let args: string = JSON.stringify({
      contractAddress,
    });

    const answer = await zkCloudWorkerRequest({
      command: "execute",
      task: "createTxTask",
      transactions: [],
      args,
      metadata: `commands txTask`,
    });
    console.log(`task api call result:`, answer);
  });

  it(`should send transactions`, async () => {
    const answer = await zkCloudWorkerRequest({
      command: "sendTransactions",
      transactions,
      metadata: `commands txs`,
    });
    console.log(`tx api call result:`, answer);
  });

  it.skip(`should restart the block validation`, async () => {
    console.log(`Restarting block validation...`);
    /*
      When the are problems with devnet and it does not produce blocks with zkApp txs for a long time
      the validation and proving of the blocks is stopped as security measure
      This call restarts the block validation
      */
    let args: string = JSON.stringify({
      contractAddress,
    });

    let answer = await zkCloudWorkerRequest({
      command: "execute",
      task: "restart",
      args,
      metadata: `commands restart`,
    });
    console.log(`restart api call result:`, answer);
  });

  it(`should get blocks info`, async () => {
    console.log(`Getting blocks info...`);
    let args: string = JSON.stringify({
      contractAddress,
    });

    let answer = await zkCloudWorkerRequest({
      command: "execute",
      task: "getBlocksInfo",
      args,
      metadata: `commands info`,
    });

    console.log(`info api call success:`, answer.success);
    if (!answer.success) return;

    let data = JSON.parse(answer.result);
    console.log(`last 10 blocks data:`, data, data?.contractState?.lastBlocks);

    /*
    const hash = data.blocks[data.blocks.length - 1].ipfs;
    const blockData = await loadFromIPFS(hash);
    console.log(`block data:`, blockData);

    const map = blockData.map;
    console.log(`map hash:`, map);
    const mapData = await loadFromIPFS(map.substring(2));
    //console.log(`map data:`, mapData);
    const startBlock = data.blocks[data.blocks.length - 1].previousBlockAddress;
    console.log(`startBlock:`, startBlock);
    args = JSON.stringify({
      contractAddress,
      startBlock,
    });

    answer = await zkCloudWorkerRequest({
      command: "execute",
      task: "getBlocksInfo",
      args,
      metadata: `commands info`,
    });
    console.log(`info api call success:`, answer.success);
    if (!answer.success) return;
    data = JSON.parse(answer.result);
    console.log(`next 10 blocks data:`, data, data?.contractState?.lastBlocks);
    */
  });
});

async function zkCloudWorkerRequest(params: {
  command: string;
  task?: string;
  transactions?: string[];
  args?: string;
  metadata?: string;
}) {
  const { command, task, transactions, args, metadata } = params;
  const apiData = {
    auth: "M6t4jtbBAFFXhLERHQWyEB9JA9xi4cWqmYduaCXtbrFjb7yaY7TyaXDunKDJNiUTBEcyUomNXJgC",
    command: command,
    jwtToken:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY0NTkwMzQ5NDYiLCJpYXQiOjE3MDEzNTY5NzEsImV4cCI6MTczMjg5Mjk3MX0.r94tKntDvLpPJT2zzEe7HMUcOAQYQu3zWNuyFFiChD0",
    data: {
      task,
      transactions: transactions ?? [],
      args,
      repo: "nameservice",
      developer: "@staketab",
      metadata,
      mode: "sync",
    },
    chain: `devnet`,
  };
  const endpoint =
    "https://cuq99yahhi.execute-api.eu-west-1.amazonaws.com/dev/zkcloudworker";

  const response = await axios.post(endpoint, apiData);
  return response.data;
}

async function loadFromIPFS(hash: string): Promise<any | undefined> {
  try {
    const url =
      "https://salmon-effective-amphibian-898.mypinata.cloud/ipfs/" +
      hash +
      "?pinataGatewayToken=gFuDmY7m1Pa5XzZ3bL1TjPPvO4Ojz6tL-VGIdweN1fUa5oSFZXce3y9mL8y1nSSU";
    //"https://gateway.pinata.cloud/ipfs/" + hash;
    const result = await axios.get(url);
    return result.data;
  } catch (error: any) {
    console.error("loadFromIPFS error:", error?.message);
    return undefined;
  }
}
