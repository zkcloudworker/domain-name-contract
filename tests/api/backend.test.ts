import { describe, expect, it } from "@jest/globals";
import { PrivateKey } from "o1js";
import axios from "axios";

const ELEMENTS_NUMBER = 4;
const transactions: string[] = [];
const contractAddress =
  "B62qrjWrAaXV65CZgpfhLdFynbFdyj851cWZPCPvF92mF3ohGDbNAME"; // added lastValidatedBlock and invalidTxsCount
//  "B62qrR3kE3S9xsQy2Jq8tp3TceWDeAmiXhU4KCXh19HzAVPj7BiNAME"; // new contract with o1js v1.0.1 and error handling
//  "B62qmyBYvHL5g7os2HFcGJC1QASTkFC8ydUBZRKGrxDqhV853YoNAME"; // new contract with o1js v1.0.1
// "B62qqNQ9kMtc4L9p19eK8SfLRy8EamtMRWAVqcCaJSM1Q5AD3DjNAME"; - old contract with o1js 0.18.0

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

describe("Domain Name Service API", () => {
  it(`should prepare transactions data`, async () => {
    console.log("Preparing data...");
    console.time(`prepared data`);
    for (let i = 0; i < ELEMENTS_NUMBER; i++) {
      const tx: Transaction = {
        operation: "add",
        name: makeString(20), // "hjdjsh..."
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
      metadata: `backend txTask`,
    });
    console.log(`task api call result:`, answer);
  });

  it.skip(`should send transactions`, async () => {
    const answer = await zkCloudWorkerRequest({
      command: "sendTransactions",
      transactions,
      metadata: `backend txs`,
    });
    console.log(`tx api call result:`, answer);
  });

  it.skip(`should get update signature`, async () => {
    const keys = [
      {
        key11: "value1",
      },
      {
        key12: "value2",
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
      "This is a description of Rollup NFT for Mina Domain Name Service";

    const tx: Transaction = {
      operation: "update",
      name: "john",
      address: "B62qrjWrAaXV65CZgpfhLdFynbFdyj851cWZPCPvF92mF3ohGDbNAME",
      oldDomain,
      expiry: Date.now() + 1000 * 60 * 60 * 24 * 365,
      metadata: JSON.stringify({
        keys,
        image,
        description,
        contractAddress: contractPublicKey.toBase58(),
      }),
    } as Transaction;

    /*
{
  operation: 'update',
  name: 'aubine',
  address: 'B62qrNQtSckFCw48oyHhVpB4JMMnDvvs98axUD5Xi9ZmShKDTqHHnKV',
  oldDomain: 'I.lnsTL4dVtHMYGjTOJ503pphs3yq8qRrfvcDVyeDkCd.hVnYp5WZB.sziBUeMarQPiOgA5J7kY_efuxHqPhpOiewtaprS0B-..Ti6qeQOvq6xgZDwSTP4U4G1nRAKhx1ZTb1fH_8Zkx6C.wSJTlw5pYgNZ1nEbULx1ZZIH1phtQSTw8kG22pgJwvB.ppjYhZ2ayVWahRneiFGZqxWZoFnc2pWdiJWN0ITdwB.2FnMyBHaxt2c1JHN6lmdydGdjNWNyI3Zyknc6BXaB.e5jqRaZ',
  expiry: 1746200931434,
  metadata: '{"keys":[{"friend1":"Rosabel"},{"friend2":"Ivett"},{"chain":"local"}],"image":{"size":287846,"mimeType":"image/jpeg","sha3_512":"qRm+FYlhRb1DHngZ0rIQHXAfMS1yTi6exdbfzrBJ/Dl1WuzCuif1v4UDsH4zY+tBFEVctBnHo2Ojv+0LBuydBw==","filename":"image.jpg","ipfsHash":"bafybeigkvkjhk7iii7b35u4e6ljpbtf5a6jdmzp3qdrn2odx76pubwvc4i"},"description":"This is a description of Rollup NFT for Mina Domain Name Service","contractAddress":"B62qjJ7tL3BKkpcC3Xu7WyahX7xyHod59N2pu57CrsDfsbrCz1Ps1Rn"}'
}

    */

    let answer = await zkCloudWorkerRequest({
      command: "execute",
      task: "prepareSignTransactionData",
      args: JSON.stringify(tx),
      metadata: `sign`,
    });
    console.log(`tx api call result:`, answer);
    /*
{
  success: true,
  jobId: undefined,
  result: '{"operation":"update","name":"aubine","address":"B62qrNQtSckFCw48oyHhVpB4JMMnDvvs98axUD5Xi9ZmShKDTqHHnKV","oldDomain":"I.lnsTL4dVtHMYGjTOJ503pphs3yq8qRrfvcDVyeDkCd.hVnYp5WZB.sziBUeMarQPiOgA5J7kY_efuxHqPhpOiewtaprS0B-..Ti6qeQOvq6xgZDwSTP4U4G1nRAKhx1ZTb1fH_8Zkx6C.wSJTlw5pYgNZ1nEbULx1ZZIH1phtQSTw8kG22pgJwvB.ppjYhZ2ayVWahRneiFGZqxWZoFnc2pWdiJWN0ITdwB.2FnMyBHaxt2c1JHN6lmdydGdjNWNyI3Zyknc6BXaB.e5jqRaZ","expiry":1746200931434,"metadata":"C.Mqwb8BnFvRN10ytntdXEpwBkats3W26l1LdjF5aMPNC.aPUUlsJAgufMt58BUO1mNCGn3k14MjxYy9uobGO7H4D.zqQGDOBjsCHJsdUFWymbXyQAXar4MAtfjhi6TtltyK","signature":"{\\"signatureData\\":[\\"3\\",\\"392999865578849\\",\\"7014059621991370199857337948387178112441331189809613583908621235103228898540\\",\\"0\\",\\"28057399436132240370810866270175313989408153359524402339534778736303282406362\\",\\"1220383054724594907887827201555292641629587111295989739548634752226487241395\\",\\"97924738292166243711069197763764186725713351314561473304046055987186121321\\",\\"2467002300102083866279152720214383891277676664443645207118296313299744632\\",\\"1746200931434\\"]}","storage":"C.2SOpP8kKRvNwk9j3o7_8T3P1O6hf-lrgD766h1UPmnB.ppjYhZ2ayVWajpnb0IWZm9mbzR3YiFXNzZGcqZGb3.4dDdi9GclxGN6NGcnpmayZHdhJTYjR3biVDezIXZB"}',
  error: undefined
}

    */
    const data = JSON.parse(answer.result);

    const signData = JSON.parse(data.signature);
    // sign it with the Auro Wallet
    tx.signature = "result of the signing with Auro Wallet";
    // send the signed transaction as usual
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
      metadata: `backend restart`,
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

/*
or

import { uniqueNamesGenerator, names } from "unique-names-generator";

function makeString(length: number = 1): string {
  return uniqueNamesGenerator({
          dictionaries: [names],
          length,
        }).toLowerCase().substring(0, 30);
}

*/
