import { describe, expect, it } from "@jest/globals";
import { saveToIPFS, loadFromIPFS } from "../src/contract/storage";
import { PINATA_JWT } from "../env.json";

describe("IPFS", () => {
  it.skip(`should save data`, async () => {
    const data = { hello: "world" };
    const result = await saveToIPFS({
      data,
      PinataJWT: PINATA_JWT,
      name: "test1.json",
    });
    console.log("result", result);
  });
  it(`should load data`, async () => {
    const result = await loadFromIPFS(
      "bafkreietui4xdkiu4xvmx4fi2jivjtndbhb4drzpxomrjvd4mdz4w2avra"
    );
    console.log("result", result);
  });
});
