/*
Example of the transaction sent using this script that calculates recursive proof for 128 actions and then reduces 128 actions:
https://minascan.io/berkeley/tx/5JuQ2hzqBMJGc2BcMNAxPgX3VaSLNGJctMzELJhViPcjdXJSTSkS?type=zk-tx


zkCloudWorker API for this script:
https://github.com/dfstio/minanft-api/blob/master/zkcloudworker.ts#L119
https://github.com/dfstio/minanft-api/blob/master/src/external/NameService/plugin.ts

Issues discovered:
https://github.com/o1-labs/o1js/issues/1426
https://github.com/o1-labs/o1js/issues/1427

Script should be run manually:
BATCH_SIZE should be set to 256
First, reset script should be run to reset the contract to the initial state:
yarn basereset
Then, after the reset tx is included into the block, the main script should be run:
yarn baseapi 
in case of archive node issues, it should be run again partially after the issues are resolved 
(1-2 hours depending on the number of actions, see issues for details)
by commenting some tests and running only the part of the script that is not executed yet.

Some of the errors of archive node are being resolved automatically within timeout, having many errors during script execution 
is normal and expected with current archive node state - see lib/fetch.ts for details or error handling.

Total billable time is about 4 hours on AWS, with 128 workers running in parallel:

Time spent to calculate and merge 128 proofs: 15 min (956016 ms)
Time to send reduce transaction for 128 actions: 2 min (143389 ms)
Total time for reducing 128 actions (it is about 256 proof calculations) - 17 minutes
Billable AWS time:  14,516,089 ms

Cost for 128 actions:
14,516 sec * 8 GB * $0.0000166667 for every GB-second = $1.93, or 0.7 cents per proof
*/

import { describe, expect, it } from "@jest/globals";
import {
  zkCloudWorker,
  formatTime,
  sleep,
  initBlockchain,
  Memory,
} from "zkcloudworker";
import {
  Field,
  PublicKey,
  MerkleMap,
  PrivateKey,
  Poseidon,
  Signature,
} from "o1js";
import {
  DomainNameContract,
  DomainName,
  BATCH_SIZE,
  ReducerState,
} from "../../contract/domain-contract";
import { Storage } from "../../contract/storage";
import { prepareProofData } from "../../rollup/txs-proof";
import { nameContract, JWT } from "../../config";
import {
  fetchMinaAccount,
  fetchMinaActions,
  checkMinaZkappTransaction,
} from "../../lib/fetch";

const ELEMENTS_COUNT = 128;
const addActions = false;

const map = new MerkleMap();
const userPrivateKeys: PrivateKey[] = [];
const elements: DomainName[] = [];
const storage = new Storage({ hashString: [Field(1), Field(2)] });

let transactions: string[] = [];

describe("Merkle map demo", () => {
  const publicKey = PublicKey.fromBase58(nameContract.contractAddress);
  const zkApp = new DomainNameContract(publicKey);
  const startTime: number[] = [];
  const endTime: number[] = [];
  const jobId: string[] = [];
  const hash: string[] = [];
  let calculateJobId = "";
  const api = new zkCloudWorker(JWT);
  let initialValue = Field(0);
  initBlockchain("berkeley");

  it("should get initial value", async () => {
    await fetchMinaAccount(publicKey);
    const zkApp = new DomainNameContract(publicKey);
    const count: Field = zkApp.count.get();
    console.log("initial count:", count.toBigInt().toString());
    initialValue = count;
  });

  if (addActions) {
    it("should generate elements", () => {
      for (let i = 0; i < ELEMENTS_COUNT; i++) {
        const name = Field(i < 2 ? 1 : i + 1000);
        const userPrivateKey = PrivateKey.random();
        const address = userPrivateKey.toPublicKey();
        const element = new DomainName({
          name,
          address,
          addressHash: Poseidon.hash(address.toFields()),
          hash: Poseidon.hash([name, ...address.toFields()]),
          storage,
        });
        elements.push(element);
        userPrivateKeys.push(userPrivateKey);
      }
    });

    it("should send the elements", async () => {
      console.time("send elements");
      for (let i = 0; i < ELEMENTS_COUNT; i++) {
        const signature = Signature.create(
          userPrivateKeys[i],
          elements[i].toFields()
        );
        const tx = {
          name: elements[i].name.toJSON(),
          address: elements[i].address.toBase58(),
          signature: signature.toBase58(),
          storage: [...elements[i].storage.toFields().map((f) => f.toJSON())],
        };
        const args = ["add", nameContract.contractAddress];
        const apiresult = await api.createJob({
          name: "nameservice",
          task: "send",
          transactions: [JSON.stringify(tx, null, 2)],
          args,
          developer: "@staketab",
        });
        startTime.push(Date.now());
        console.log("add api call result", apiresult);
        expect(apiresult.success).toBe(true);
        expect(apiresult.jobId).toBeDefined();
        if (apiresult.jobId === undefined) return;
        jobId.push(apiresult.jobId);
      }
      console.timeEnd("send elements");
      Memory.info(`should send the elements`);
    });

    it(`should get the tx hashes`, async () => {
      let i = 0;
      for (const id of jobId) {
        const result = await api.waitForJobResult({ jobId: id });
        endTime.push(Date.now());
        console.log(
          `Time spent to send add tx: ${formatTime(
            endTime[i] - startTime[i]
          )} (${endTime[i] - startTime[i]} ms)`
        );
        console.log("add api call result", result);
        //expect(result.success).toBe(true);
        if (result.success === true) {
          const txHash = result.result.result;
          console.log("add txHash", txHash);
          //expect(txHash).toBeDefined();
          if (txHash !== undefined) hash.push(txHash);
        }
        i++;
      }
    });

    it(`should wait for tx to be included into block`, async () => {
      console.log(
        `Sent add txs: ${hash.length}/${ELEMENTS_COUNT} (${Math.floor(
          (hash.length * 100) / ELEMENTS_COUNT
        )}%)`
      );
      expect(hash.length).toBeGreaterThan(0);
      if (hash.length === 0) return;
      console.log("Waiting for add txs to be included into block...", hash);
      console.time("txs included into block");
      let remainedTx = hash.length;
      while (remainedTx > 0) {
        await sleep(1000 * 30);
        for (const h of hash) {
          const result = await checkMinaZkappTransaction(h);
          if (result.success) {
            console.log("add tx included into block:", h);
            remainedTx--;
          }
        }
      }
      console.timeEnd("txs included into block");
      await sleep(1000 * 60 * 5);
    });
  }

  /*
  it("should check the actions", async () => {
    console.time("check actions");
    await fetchAccount(publicKey);
    const actions2 = await Mina.fetchActions(publicKey);
    if (Array.isArray(actions2)) {
      console.log("all actions:", actions2.length);
    }
  });
  */

  it("should prepare and send the state update txs", async () => {
    await fetchMinaAccount(publicKey);
    let length = 0;
    let startActionState: Field = zkApp.actionState.get();
    console.log("startActionState", startActionState.toJSON());
    let actions = await fetchMinaActions(publicKey, startActionState);
    if (Array.isArray(actions)) {
      length = Math.min(actions.length, BATCH_SIZE);
      console.log("actions total length from startActionState", actions.length);
    } else throw new Error("actions is not an array");
    while (length === 0 && hash.length > 0) {
      await sleep(1000 * 60);
      await fetchMinaAccount(publicKey);
      startActionState = zkApp.actionState.get();
      actions = await fetchMinaActions(publicKey, startActionState);
      if (Array.isArray(actions)) {
        length = Math.min(actions.length, BATCH_SIZE);
        console.log(
          "actions total length from startActionState",
          actions.length
        );
      } else throw new Error("actions is not an array");
    }
    while (length > 0) {
      console.time("reduce");
      if (Array.isArray(actions)) {
        console.log("reduce length", length);
        let hash: Field = Field(0);
        const elements: DomainName[] = [];
        for (let i = 0; i < length; i++) {
          const element: DomainName = DomainName.fromFields(
            actions[i].actions[0].map((f: string) => Field.fromJSON(f))
          );
          hash = hash.add(element.hash);
          elements.push(element);
        }
        const reducerState = new ReducerState({
          count: Field(length),
          hash,
        });
        console.log("startActionsState", startActionState.toJSON());
        const endActionState: Field = Field.fromJSON(actions[length - 1].hash);
        console.log("endActionState", endActionState.toJSON());
        console.log("actions", actions);
        const actions2 = await fetchMinaActions(publicKey, startActionState);
        if (Array.isArray(actions2)) {
          console.log("actions2 length", actions2.length);
          /*
          if (actions2.length !== length)
            throw new Error("actions2 length is not equal to length");
          */
        } else throw new Error("actions2 is not an array");

        const proofData = await prepareProofData(elements, map);
        transactions = proofData.transactions;
        const update = proofData.state;
        console.log("sending proofMap job", update.length);
        const signature = Signature.create(
          baseContract.ownerPrivateKey,
          update
        );
        let args = [baseContract.contractAddress];

        let apiresult = await api.createJob({
          name: "nameservice",
          task: "proofMap",
          transactions,
          args,
          developer: "@staketab",
        });
        let startTime = Date.now();
        console.log("proofMap api call result", apiresult);
        expect(apiresult.success).toBe(true);
        expect(apiresult.jobId).toBeDefined();
        if (apiresult.jobId === undefined) return;
        calculateJobId = apiresult.jobId;
        Memory.info(`calculate proof`);
        let result = await api.waitForJobResult({ jobId: calculateJobId });
        let endTime = Date.now();
        console.log(
          `Time spent to calculate the proof: ${formatTime(
            endTime - startTime
          )} (${endTime - startTime} ms)`
        );
        //console.log("api call result", result);
        expect(result.success).toBe(true);
        if (result.success === false) return;
        const proof = result.result.result;
        //console.log("proof", proof);
        expect(proof).toBeDefined();
        if (proof === undefined) return;
        const tx = {
          startActionState: startActionState.toJSON(),
          endActionState: endActionState.toJSON(),
          reducerState: {
            count: reducerState.count.toJSON(),
            hash: reducerState.hash.toJSON(),
          },
          proof,
          signature: signature.toBase58(),
        };
        console.log("reduce job count", tx.reducerState.count);

        args = ["reduce", baseContract.contractAddress];

        apiresult = await api.createJob({
          name: "nameservice",
          task: "send",
          transactions: [JSON.stringify(tx, null, 2)],
          args,
          developer: "@staketab",
        });
        startTime = Date.now();
        console.log("reduce api call result", apiresult);
        expect(apiresult.success).toBe(true);
        expect(apiresult.jobId).toBeDefined();
        if (apiresult.jobId === undefined) return;
        calculateJobId = apiresult.jobId;
        Memory.info(`calculate proof`);
        result = await api.waitForJobResult({ jobId: calculateJobId });
        endTime = Date.now();
        console.log(
          `Time spent to sent the reduce tx: ${formatTime(
            endTime - startTime
          )} (${endTime - startTime} ms)`
        );
        console.log("reduce api call result", result);
        expect(result.success).toBe(true);
        if (result.success === false) return;
        const txHash = result.result.result;
        console.log("txHash", txHash);
        expect(txHash).toBeDefined();
        if (txHash === undefined) return;
        expect(txHash).not.toBe("");
        if (txHash === "") return;
        console.log("Waiting for reduce tx to be included into block...");
        console.time("reduce tx included into block");
        let remainedTx = 1;
        while (remainedTx > 0) {
          await sleep(1000 * 30);
          const result = await checkMinaZkappTransaction(txHash);
          if (result.success) {
            console.log("tx included into block:", txHash);
            remainedTx--;
          }
        }
        console.timeEnd("reduce tx included into block");
      }
      await sleep(1000 * 60);
      await fetchMinaAccount(publicKey);
      startActionState = zkApp.actionState.get();
      actions = await fetchMinaActions(publicKey, startActionState);
      if (actions && Array.isArray(actions))
        length = Math.min(actions.length, BATCH_SIZE);
      else throw new Error("actions is not an array");
      console.timeEnd("reduce");
    }
  });

  it("should get final values", async () => {
    await fetchMinaAccount(publicKey);
    const zkApp = new DomainNameContract(publicKey);
    const count: Field = zkApp.count.get();
    const root: Field = zkApp.root.get();
    console.log("final count:", count.toJSON());
    console.log("final root:", root.toJSON());
    initialValue = count;
  });
  /*
  it("should reset the value", async () => {
    const map = new MerkleMap();
    const root = map.getRoot();
    const count = Field(0);
    const signature = Signature.create(ownerPrivateKey, [root, count]);
    const tx = {
      root: root.toJSON(),
      count: count.toJSON(),
      signature: signature.toBase58(),
    };
    const args = ["setRoot", contractAddress];

    const apiresult = await api.createJob({
      name: "nameservice",
      task: "send",
      transactions: [JSON.stringify(tx, null, 2)],
      args,
      developer: "@staketab",
    });
    const startTime = Date.now();
    console.log("reset api call result", apiresult);
    expect(apiresult.success).toBe(true);
    expect(apiresult.jobId).toBeDefined();
    if (apiresult.jobId === undefined) return;
    calculateJobId = apiresult.jobId;
    Memory.info(`reset`);
    const result = await api.waitForJobResult({ jobId: calculateJobId });
    const endTime = Date.now();
    console.log(
      `Time spent to sent the reset tx: ${formatTime(endTime - startTime)} (${
        endTime - startTime
      } ms)`
    );
    console.log("reset api call result", result);
    expect(result.success).toBe(true);
    if (result.success === false) return;
    const txHash = result.result.result;
    console.log("txHash", txHash);
    expect(txHash).toBeDefined();
    if (txHash === undefined) return;
    expect(txHash).not.toBe("");
    if (txHash === "") return;
    console.log("Waiting for reset tx to be included into block...");
    console.time("reset tx included into block");
    let remainedTx = 1;
    while (remainedTx > 0) {
      await sleep(1000 * 30);
      const result = await checkZkappTransaction(txHash);
      if (result.success) {
        console.log("reset tx included into block:", txHash);
        remainedTx--;
      }
    }
    console.timeEnd("reset tx included into block");
  });

  it("should get final values after reset", async () => {
    await fetchAccount(publicKey);
    const zkApp = new DomainNameContract(publicKey);
    const count: Field = zkApp.count.get();
    const root: Field = zkApp.root.get();
    console.log("final count:", count.toJSON());
    console.log("final root:", root.toJSON());
    initialValue = count;
  });
  */
});
