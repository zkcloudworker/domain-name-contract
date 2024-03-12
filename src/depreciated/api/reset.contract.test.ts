import { describe, expect, it } from "@jest/globals";
import {
  zkCloudWorker,
  formatTime,
  sleep,
  initBlockchain,
  Memory,
} from "zkcloudworker";
import { Field, PublicKey, MerkleMap, Signature } from "o1js";
import { DomainNameContract } from "../../src/base/mapcontract";
import { JWT, baseContract } from "../../config";
import { checkMinaZkappTransaction, fetchMinaAccount } from "../../lib/fetch";

describe("Merkle map demo reset", () => {
  const publicKey = PublicKey.fromBase58(baseContract.contractAddress);
  let calculateJobId = "";
  const api = new zkCloudWorker(JWT);
  let initialValue = Field(0);
  initBlockchain("berkeley");

  let initialRoot: Field = Field(0);
  let initialCount: Field = Field(0);

  it("should get initial value", async () => {
    await fetchMinaAccount(publicKey);
    const zkApp = new DomainNameContract(publicKey);
    const count: Field = zkApp.count.get();
    const root: Field = zkApp.root.get();
    console.log("initial count:", count.toJSON());
    console.log("initial root:", root.toJSON());
    initialRoot = root;
    initialCount = count;
  });

  it("should reset the value", async () => {
    const map = new MerkleMap();
    const root = map.getRoot();
    const count = Field(0);
    if (
      root.equals(initialRoot).toBoolean() &&
      count.equals(initialCount).toBoolean()
    ) {
      console.log(
        "Root and count are the same as initial ones. No need to reset"
      );
      return;
    }
    const signature = Signature.create(baseContract.ownerPrivateKey, [
      root,
      count,
    ]);
    const tx = {
      root: root.toJSON(),
      count: count.toJSON(),
      signature: signature.toBase58(),
    };
    const args = ["setRoot", baseContract.contractAddress];

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
      const result = await checkMinaZkappTransaction(txHash);
      if (result.success) {
        console.log("reset tx included into block:", txHash);
        remainedTx--;
      }
    }
    console.timeEnd("reset tx included into block");
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
});
