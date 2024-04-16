import { describe, expect, it } from "@jest/globals";
import { Field, PrivateKey, UInt64, PublicKey } from "o1js";
import { nameContract } from "../../src/config";
import { stringToFields } from "../../src/lib/hash";
import { Storage } from "../../src/contract/storage";
import { JWT } from "../../src/config";
import { zkCloudWorkerClient, makeString, sleep } from "zkcloudworker";
import {
  DomainName,
  DomainNameValue,
  DomainTransaction,
  DomainTransactionData,
  DomainTransactionEnum,
} from "../../src/rollup/transaction";
import { Metadata } from "../../src/contract/metadata";

const api = new zkCloudWorkerClient({
  jwt: JWT,
  chain: "devnet",
});

const ELEMENTS_NUMBER = 1;
const BLOCKS_NUMBER = 1;
const domainNames: string[][] = [];
const contractPublicKey = PublicKey.fromBase58(nameContract.contractAddress);

describe("Domain Name Service Contract", () => {
  it(`should prepare blocks data`, async () => {
    console.log("Preparing data...");
    console.time(`prepared data`);
    const nftStorage = new Storage({ hashString: [Field(0), Field(0)] });
    for (let j = 0; j < BLOCKS_NUMBER; j++) {
      const blockElements: string[] = [];
      for (let i = 0; i < ELEMENTS_NUMBER; i++) {
        const domainName: DomainName = new DomainName({
          name: stringToFields(makeString(20))[0],
          data: new DomainNameValue({
            address: PrivateKey.random().toPublicKey(),
            metadata: new Metadata({
              data: Field(0),
              kind: Field(0),
            }),
            storage: nftStorage,
            expiry: UInt64.from(Date.now() + 1000 * 60 * 60 * 24 * 365),
          }),
        });
        const domainTransaction: DomainTransaction = new DomainTransaction({
          type: DomainTransactionEnum.add,
          domain: domainName,
        });
        const domainTransactionData: DomainTransactionData =
          new DomainTransactionData(domainTransaction);
        blockElements.push(
          JSON.stringify(domainTransactionData.toJSON(), null, 2)
        );
      }
      domainNames.push(blockElements);
    }
    console.timeEnd(`prepared data`);
  });

  it(`should add task to process transactions`, async () => {
    console.log(`Adding task to process transactions...`);
    let args: string = JSON.stringify({
      contractAddress: contractPublicKey.toBase58(),
    });

    let sent = false;
    let apiresult;
    let attempt = 1;
    while (sent === false) {
      apiresult = await api.execute({
        repo: "nameservice",
        task: "createTxTask",
        transactions: [],
        args,
        developer: "@staketab",
        metadata: `txTask`,
      });
      console.log(`task apiresult:`, apiresult);
      if (apiresult.success === true) sent = true;
      else {
        console.log(`Error creating job for txTask, retrying...`);
        await sleep(30000 * attempt);
        attempt++;
      }
    }

    expect(apiresult).toBeDefined();
    if (apiresult === undefined) return;
    expect(apiresult.success).toBe(true);

    expect(apiresult.jobId).toBeDefined();
    console.log(`txTask created, jobId:`, apiresult.jobId);
    if (apiresult.jobId === undefined) return;
  });

  for (let i = 0; i < BLOCKS_NUMBER; i++) {
    const blockNumber = i + 1;
    it(`should create a block`, async () => {
      console.time(`Txs to the block ${blockNumber} sent`);
      for (let j = 0; j < ELEMENTS_NUMBER; j++) {
        let sent = false;
        let apiresult;
        let attempt = 1;
        while (sent === false) {
          apiresult = await api.sendTransaction({
            repo: "nameservice",
            transaction: domainNames[i][j],
            developer: "@staketab",
          });
          console.log(`tx apiresult:`, apiresult);
          if (apiresult.success === true) sent = true;
          else {
            console.log(`Error sending tx ${j} to block ${i}, retrying...`);
            await sleep(30000 * attempt);
            attempt++;
          }
        }

        expect(apiresult).toBeDefined();
        if (apiresult === undefined) return;
        expect(apiresult.success).toBe(true);

        expect(apiresult.jobId).toBeDefined();
        console.log(`Tx ${j + 1} sent, jobId:`, apiresult.jobId);
        if (apiresult.jobId === undefined)
          throw new Error("Job ID is undefined");
        await sleep(2000);
      }
      console.timeEnd(`Txs to the block ${blockNumber} sent`);
    });
  }
});
