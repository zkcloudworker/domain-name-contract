import { describe, expect, it } from "@jest/globals";
import { PrivateKey, Field, Signature } from "o1js";
import axios from "axios";
import { nameContract } from "../../src/config";
import { uniqueNamesGenerator, names } from "unique-names-generator";
import { sleep } from "zkcloudworker";

const ELEMENTS_NUMBER = 7;
const transactions: string[] = [];
const contractAddress = nameContract.contractAddress;

type DomainTransactionType = "add" | "extend" | "update" | "remove";
interface Transaction {
  operation: DomainTransactionType;
  name: string;
  address: string;
  expiry: number;
  metadata?: string;
  storage?: string;
  oldDomain?: string;
  signature?: string;
}

const name = "bob";
const key = PrivateKey.fromBase58(
  // "B62qj9e7AMwgDuuWtXG5FRdENBtsorEPbBaYHnG8d5KeAqKkEJANAME"
  "EKEDXUx9yeN5iA6TxqQvXnLmRjGkQGHJsiQgQgLNgFLVvE3u4kAv"
);
const oldDomain =
  "I.3GyDb-mGcS3wKzNxQngu4VuJ5I1zCdiUDSzvhiL7ia.i9mYB.U0LY4OOs39fTpXOwAUbXaG5OhX5w1F0krHH1060XjOC..5XHfJ83GMwNe23H6I-YQ5fscsdMbTElqKnC3j3Si6YC.5WapXO2VlgP96My9pB71lcDJHnVkGCshArB53d47-IB.ppjYhZ2ayVWaodXc5hmcm1GavZXY6dzZ2V2dzdXZzB.qh3b3Z3YqV3YygGNrpXd6ZTYlJWcux2dpRDbu9WYB.hPZoXaZ";

const addTransaction: Transaction = {
  operation: "add",
  name,
  address: key.toPublicKey().toBase58(),
  expiry: Date.now() + 1000 * 60 * 60 * 24 * 365, // one year
};

describe("Domain Name Service API", () => {
  it.skip(`should prepare transactions data`, async () => {
    console.log("Preparing data...");
    console.time(`prepared data`);
    //transactions.push("this is invalid tx 1");
    //transactions.push("this is invalid tx 2");
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
      //transactions.push(tx);
    }

    console.timeEnd(`prepared data`);
  });

  it.skip(`should prepare add transaction`, async () => {
    transactions.push(JSON.stringify(addTransaction, null, 2));
  });

  it.skip(`should prepare update transaction`, async () => {
    const keys = [
      {
        key11: "value11-5",
      },
      {
        key12: "value12-5",
      },
      {
        chain: "devnet",
      },
    ];

    interface ImageData {
      size: number;
      sha3_512: string;
      mimeType: string;
      filename: string;
      ipfsHash: string;
    }

    const image: ImageData = {
      size: 287846,
      mimeType: "image/jpeg",
      sha3_512:
        "qRm+FYlhRb1DHngZ0rIQHXAfMS1yTi6exdbfzrBJ/Dl1WuzCuif1v4UDsH4zY+tBFEVctBnHo2Ojv+0LBuydBw==",
      filename: "image.jpg",
      ipfsHash: "bafybeigkvkjhk7iii7b35u4e6ljpbtf5a6jdmzp3qdrn2odx76pubwvc4i",
    } as ImageData;

    const description =
      "This is a description of Rollup NFT for Mina Domain Name Servicen for name " +
      name;

    const tx: Transaction = {
      operation: "update",
      name,
      address: key.toPublicKey().toBase58(),
      oldDomain,
      expiry: Date.now() + 1000 * 60 * 60 * 24 * 365,
      metadata: JSON.stringify({
        keys,
        image,
        description,
        contractAddress,
      }),
    } as Transaction;

    console.log(`tx:`, tx);
    let args: string = JSON.stringify({
      contractAddress,
      tx,
    });

    let answer = await zkCloudWorkerRequest({
      command: "execute",
      task: "prepareSignTransactionData",
      args,
      metadata: `command sign`,
      mode: "async",
    });
    console.log(`sign api call result:`, answer);
    const jobId = answer.jobId;
    console.log(`jobId:`, jobId);
    let result: string | undefined = undefined;
    while (result === undefined) {
      await sleep(5000);
      answer = await zkCloudWorkerRequest({
        command: "jobResult",
        jobId,
      });
      console.log(`jobResult api call result:`, answer);
      result = answer.result;
    }

    const tx2 = JSON.parse(result);
    console.log(`tx2:`, tx2);

    const signData = JSON.parse(tx2.signature).signatureData.map((v: string) =>
      Field.fromJSON(v)
    );
    await sleep(1000);
    const signature = Signature.create(key, signData);
    tx2.signature = signature.toBase58();
    console.log(`tx2 signed:`, tx2);
    transactions.push(JSON.stringify(tx2, null, 2));
    await sleep(1000);
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

  it.skip(`should send transactions`, async () => {
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

  it(`should get name info`, async () => {
    console.log(`Getting name info...`);
    const domain = oldDomain;
    let args: string = JSON.stringify({
      contractAddress,
      domain,
    });

    let answer = await zkCloudWorkerRequest({
      command: "execute",
      task: "getMetadata",
      args,
      metadata: `commands info`,
    });

    console.log(`info api call success:`, answer.success);
    if (!answer.success) return;

    let data = JSON.parse(answer.result);
    console.log(`metadata:`, data, data.nft.properties);
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
    console.log(`contract state:`, data, data?.contractState);

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
  mode?: string;
  jobId?: string;
}) {
  const { command, task, transactions, args, metadata, mode, jobId } = params;
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
      mode: mode ?? "sync",
      jobId,
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
