import { describe, expect, it } from "@jest/globals";
import { saveToIPFS, loadFromIPFS } from "../src/contract/storage";
import { PINATA_JWT } from "../env.json";

let hash: string = "";

describe("IPFS", () => {
  it(`should save data`, async () => {
    const data = { hello: "world" };
    const result = await saveToIPFS({
      data,
      pinataJWT: PINATA_JWT,
      name: "test1.json",
    });
    console.log("result", result);
    expect(result).toBeDefined();
    if (result === undefined) return;
    hash = result;
  });
  it(`should load data`, async () => {
    if (hash === "") return;
    const result = await loadFromIPFS(hash);
    console.log("result", result);
  });
});
