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

const name = "john";
const key = PrivateKey.fromBase58(
  // "B62qj9e7AMwgDuuWtXG5FRdENBtsorEPbBaYHnG8d5KeAqKkEJANAME"
  "EKEDXUx9yeN5iA6TxqQvXnLmRjGkQGHJsiQgQgLNgFLVvE3u4kAv"
);
const oldDomain =
  "I.jSFuCAJbyOCugCaZLsx8sjAM0PVVv-9YYUudtIwTSU.q9GauF.U0LY4OOs39fTpXOwAUbXaG5OhX5w1F0krHH1060XjOC..A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.ppjYhZ2ayVWaklGa0ZWajhWeyl3Y5Vmbrt2aml3N2B.1tGajN3YjlmZ5JHa28mYiZHZtJnYrFnbrJTNmZDNB.ZtxNSaZ";

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

  it(`should prepare update transaction`, async () => {
    const keys = [
      {
        key11: "value11",
      },
      {
        key12: "value12",
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
    /*

tx: {
  operation: 'update',
  name: 'john',
  address: 'B62qj9e7AMwgDuuWtXG5FRdENBtsorEPbBaYHnG8d5KeAqKkEJANAME',
  oldDomain: 'I.jSFuCAJbyOCugCaZLsx8sjAM0PVVv-9YYUudtIwTSU.q9GauF.U0LY4OOs39fTpXOwAUbXaG5OhX5w1F0krHH1060XjOC..A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.ppjYhZ2ayVWaklGa0ZWajhWeyl3Y5Vmbrt2aml3N2B.1tGajN3YjlmZ5JHa28mYiZHZtJnYrFnbrJTNmZDNB.ZtxNSaZ',
  expiry: 1746215243316,
  metadata: '{"keys":[{"key11":"value11"},{"key12":"value12"},{"chain":"devnet"}],"image":{"size":287846,"mimeType":"image/jpeg","sha3_512":"qRm+FYlhRb1DHngZ0rIQHXAfMS1yTi6exdbfzrBJ/Dl1WuzCuif1v4UDsH4zY+tBFEVctBnHo2Ojv+0LBuydBw==","filename":"image.jpg","ipfsHash":"bafybeigkvkjhk7iii7b35u4e6ljpbtf5a6jdmzp3qdrn2odx76pubwvc4i"},"description":"This is a description of Rollup NFT for Mina Domain Name Servicen for name john","contractAddress":"B62qrjWrAaXV65CZgpfhLdFynbFdyj851cWZPCPvF92mF3ohGDbNAME"}'
}
    */
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
    /*
sign api call result: {
  success: true,
  jobId: '6459034946.1714679244719.ItJltbhrIL8B4HAcIv2MCpgO3CqPIxVZ'
    */
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
      /*
jobResult api call result: {
  metadata: 'command sign',
  task: 'prepareSignTransactionData',
  maxAttempts: 0,
  args: '{"contractAddress":"B62qrjWrAaXV65CZgpfhLdFynbFdyj851cWZPCPvF92mF3ohGDbNAME","tx":{"operation":"update","name":"john","address":"B62qj9e7AMwgDuuWtXG5FRdENBtsorEPbBaYHnG8d5KeAqKkEJANAME","oldDomain":"I.jSFuCAJbyOCugCaZLsx8sjAM0PVVv-9YYUudtIwTSU.q9GauF.U0LY4OOs39fTpXOwAUbXaG5OhX5w1F0krHH1060XjOC..A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.ppjYhZ2ayVWaklGa0ZWajhWeyl3Y5Vmbrt2aml3N2B.1tGajN3YjlmZ5JHa28mYiZHZtJnYrFnbrJTNmZDNB.ZtxNSaZ","expiry":1746215243316,"metadata":"{\\"keys\\":[{\\"key11\\":\\"value11\\"},{\\"key12\\":\\"value12\\"},{\\"chain\\":\\"devnet\\"}],\\"image\\":{\\"size\\":287846,\\"mimeType\\":\\"image/jpeg\\",\\"sha3_512\\":\\"qRm+FYlhRb1DHngZ0rIQHXAfMS1yTi6exdbfzrBJ/Dl1WuzCuif1v4UDsH4zY+tBFEVctBnHo2Ojv+0LBuydBw==\\",\\"filename\\":\\"image.jpg\\",\\"ipfsHash\\":\\"bafybeigkvkjhk7iii7b35u4e6ljpbtf5a6jdmzp3qdrn2odx76pubwvc4i\\"},\\"description\\":\\"This is a description of Rollup NFT for Mina Domain Name Servicen for name john\\",\\"contractAddress\\":\\"B62qrjWrAaXV65CZgpfhLdFynbFdyj851cWZPCPvF92mF3ohGDbNAME\\"}"}}',
  timeCreated: 1714679244719,
  timeCreatedString: '2024-05-02T19:47:24.719Z',
  jobId: '6459034946.1714679244719.ItJltbhrIL8B4HAcIv2MCpgO3CqPIxVZ',
  repo: 'nameservice',
  developer: '@staketab',
  chain: 'devnet',
  txNumber: 1,
  jobStatus: 'started',
  id: '6459034946',
  timeStarted: 1714679244903
}

last call:

 jobResult api call result: {
  metadata: 'command sign',
  task: 'prepareSignTransactionData',
  maxAttempts: 1,
  args: '{"contractAddress":"B62qrjWrAaXV65CZgpfhLdFynbFdyj851cWZPCPvF92mF3ohGDbNAME","tx":{"operation":"update","name":"john","address":"B62qj9e7AMwgDuuWtXG5FRdENBtsorEPbBaYHnG8d5KeAqKkEJANAME","oldDomain":"I.jSFuCAJbyOCugCaZLsx8sjAM0PVVv-9YYUudtIwTSU.q9GauF.U0LY4OOs39fTpXOwAUbXaG5OhX5w1F0krHH1060XjOC..A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.ppjYhZ2ayVWaklGa0ZWajhWeyl3Y5Vmbrt2aml3N2B.1tGajN3YjlmZ5JHa28mYiZHZtJnYrFnbrJTNmZDNB.ZtxNSaZ","expiry":1746215243316,"metadata":"{\\"keys\\":[{\\"key11\\":\\"value11\\"},{\\"key12\\":\\"value12\\"},{\\"chain\\":\\"devnet\\"}],\\"image\\":{\\"size\\":287846,\\"mimeType\\":\\"image/jpeg\\",\\"sha3_512\\":\\"qRm+FYlhRb1DHngZ0rIQHXAfMS1yTi6exdbfzrBJ/Dl1WuzCuif1v4UDsH4zY+tBFEVctBnHo2Ojv+0LBuydBw==\\",\\"filename\\":\\"image.jpg\\",\\"ipfsHash\\":\\"bafybeigkvkjhk7iii7b35u4e6ljpbtf5a6jdmzp3qdrn2odx76pubwvc4i\\"},\\"description\\":\\"This is a description of Rollup NFT for Mina Domain Name Servicen for name john\\",\\"contractAddress\\":\\"B62qrjWrAaXV65CZgpfhLdFynbFdyj851cWZPCPvF92mF3ohGDbNAME\\"}"}}',
  timeFinished: 1714679264673,
  timeCreated: 1714679244719,
  timeCreatedString: '2024-05-02T19:47:24.719Z',
  jobId: '6459034946.1714679244719.ItJltbhrIL8B4HAcIv2MCpgO3CqPIxVZ',
  result: '{"operation":"update","name":"john","address":"B62qj9e7AMwgDuuWtXG5FRdENBtsorEPbBaYHnG8d5KeAqKkEJANAME","oldDomain":"I.jSFuCAJbyOCugCaZLsx8sjAM0PVVv-9YYUudtIwTSU.q9GauF.U0LY4OOs39fTpXOwAUbXaG5OhX5w1F0krHH1060XjOC..A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.ppjYhZ2ayVWaklGa0ZWajhWeyl3Y5Vmbrt2aml3N2B.1tGajN3YjlmZ5JHa28mYiZHZtJnYrFnbrJTNmZDNB.ZtxNSaZ","expiry":1746215243316,"metadata":"C.fAW2srcSmCz-encl9ZzlWc6dr0OCHT8V_FYbDHqh34B.MJiwWztFaIjsHeHy1sQZjLK-cJWb_SMKHJ3ynEdQJ7C.5WapXO2VlgP96My9pB71lcDJHnVkGCshArB53d47-IB","signature":"{\\"signatureData\\":[\\"3\\",\\"6147305322\\",\\"16119603559795592684705059328739174182476087791571536533914181363529284631828\\",\\"0\\",\\"21161981547182976305517746574118117871656156516836062223210247855127985791564\\",\\"8252828962110737286457977138501801683497326888025574661025446278939669800377\\",\\"212783729872118894052159228882332477432662860532627661668176594586847820393\\",\\"2494185376037963918275203287858623942800206634428433309751950176614244713\\",\\"1746215243316\\"]}","storage":"C.w-49SKAOFysvBBFBPdFNUOCslaojXY1oRkawP9JkFiD.ppjYhZ2ayVWah5GbyUTeyQmexBXdhlHaodjMysmb4B.pFmNylXZ2dzZycnM3k3MnR2NqlmYt9Ga1oWN6JWaB"}',
  repo: 'nameservice',
  developer: '@staketab',
  chain: 'devnet',
  txNumber: 1,
  jobStatus: 'finished',
  billedDuration: 19793,
  id: '6459034946',
  timeStarted: 1714679244903
}

      */
      result = answer.result;
    }

    const tx2 = JSON.parse(result);
    console.log(`tx2:`, tx2);
    /*
tx2: {
  operation: 'update',
  name: 'john',
  address: 'B62qj9e7AMwgDuuWtXG5FRdENBtsorEPbBaYHnG8d5KeAqKkEJANAME',
  oldDomain: 'I.jSFuCAJbyOCugCaZLsx8sjAM0PVVv-9YYUudtIwTSU.q9GauF.U0LY4OOs39fTpXOwAUbXaG5OhX5w1F0krHH1060XjOC..A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.ppjYhZ2ayVWaklGa0ZWajhWeyl3Y5Vmbrt2aml3N2B.1tGajN3YjlmZ5JHa28mYiZHZtJnYrFnbrJTNmZDNB.ZtxNSaZ',
  expiry: 1746215243316,
  metadata: 'C.fAW2srcSmCz-encl9ZzlWc6dr0OCHT8V_FYbDHqh34B.MJiwWztFaIjsHeHy1sQZjLK-cJWb_SMKHJ3ynEdQJ7C.5WapXO2VlgP96My9pB71lcDJHnVkGCshArB53d47-IB',
  signature: '{"signatureData":["3","6147305322","16119603559795592684705059328739174182476087791571536533914181363529284631828","0","21161981547182976305517746574118117871656156516836062223210247855127985791564","8252828962110737286457977138501801683497326888025574661025446278939669800377","212783729872118894052159228882332477432662860532627661668176594586847820393","2494185376037963918275203287858623942800206634428433309751950176614244713","1746215243316"]}',
  storage: 'C.w-49SKAOFysvBBFBPdFNUOCslaojXY1oRkawP9JkFiD.ppjYhZ2ayVWah5GbyUTeyQmexBXdhlHaodjMysmb4B.pFmNylXZ2dzZycnM3k3MnR2NqlmYt9Ga1oWN6JWaB'
}

    */

    const signData = JSON.parse(tx2.signature).signatureData.map((v: string) =>
      Field.fromJSON(v)
    ); // pass instaed to Auro Wallet JSON.parse(tx2.signature).signatureData

    const signature = Signature.create(key, signData); // sign instaed with Auro Wallet
    tx2.signature = signature.toBase58();
    console.log(`tx2 signed:`, tx2);
    /*
 tx2 signed: {
  operation: 'update',
  name: 'john',
  address: 'B62qj9e7AMwgDuuWtXG5FRdENBtsorEPbBaYHnG8d5KeAqKkEJANAME',
  oldDomain: 'I.jSFuCAJbyOCugCaZLsx8sjAM0PVVv-9YYUudtIwTSU.q9GauF.U0LY4OOs39fTpXOwAUbXaG5OhX5w1F0krHH1060XjOC..A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.A_RucMswIrv5PMYqhYk1rFtzBt2i7kMd-J_70JBXBJD.ppjYhZ2ayVWaklGa0ZWajhWeyl3Y5Vmbrt2aml3N2B.1tGajN3YjlmZ5JHa28mYiZHZtJnYrFnbrJTNmZDNB.ZtxNSaZ',
  expiry: 1746215243316,
  metadata: 'C.fAW2srcSmCz-encl9ZzlWc6dr0OCHT8V_FYbDHqh34B.MJiwWztFaIjsHeHy1sQZjLK-cJWb_SMKHJ3ynEdQJ7C.5WapXO2VlgP96My9pB71lcDJHnVkGCshArB53d47-IB',
  signature: '7mX7tSCTtAS5Bvrm6TnmcxeJcy3pjbdUZ2tcJG2mz4B2F9r42DN7kJbyQw1q5bWJAUpzc3xpQxTaU7fDiKw1n3EXQ1Xhx7pc',
  storage: 'C.w-49SKAOFysvBBFBPdFNUOCslaojXY1oRkawP9JkFiD.ppjYhZ2ayVWah5GbyUTeyQmexBXdhlHaodjMysmb4B.pFmNylXZ2dzZycnM3k3MnR2NqlmYt9Ga1oWN6JWaB'
}

    */
    transactions.push(JSON.stringify(tx2, null, 2));
    await sleep(1000);
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
