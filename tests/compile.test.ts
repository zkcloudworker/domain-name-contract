import { describe, expect, it } from "@jest/globals";
import { MapUpdate } from "../src/rollup/transaction";
import { Cache } from "o1js";

describe("Compile", () => {
  it(`should compile the ZkProgram`, async () => {
    const cache: Cache = Cache.FileSystem("./cache");
    console.log("Compiling MapUpdate...");
    await MapUpdate.compile({ cache });
  });
});
