import { describe, expect, it } from "@jest/globals";
import { MapUpdate } from "../src/rollup/transaction";
import {
  MapUpdateNew,
  MapUpdateProofNew,
  MapTransition,
} from "../src/rollup/transaction-new";
import {
  state,
  State,
  Field,
  SmartContract,
  method,
  ZkProgram,
  Cache,
  UInt64,
  UInt32,
  Struct,
} from "o1js";

export class MyContract1 extends SmartContract {
  @state(Field) value = State<Field>();

  @method async setValue(proof: MapUpdateProofNew) {
    //proof.verify();
    this.setValueInternal(proof);
  }

  setValueInternal(proof: MapUpdateProofNew) {
    proof.verify();
    this.value.set(proof.publicOutput.newRoot);
  }
}

export class MyContract4 extends SmartContract {
  @state(Field) value = State<Field>();

  @method async setValue(proof: MapUpdateProofNew) {
    proof.verify();
    this.setValueInternal(proof.publicOutput);
  }

  setValueInternal(map: MapTransition) {
    this.value.set(map.newRoot);
  }
}

export class MyContract2 extends SmartContract {
  @state(Field) value = State<Field>();

  @method async setValue(map: MapTransition) {
    this.value.set(map.newRoot);
  }
}

export class MapTransition1 extends Struct({
  oldRoot: Field,
  newRoot: Field,
  time: UInt64, // unix time when the map was updated
  hash: Field, // sum of hashes of all the new keys and values of the Map
  count: UInt32, // number of new keys in the Map
}) {}

export class MyContract3 extends SmartContract {
  @state(Field) value = State<Field>();

  @method async setValue(map: MapTransition1) {
    this.value.set(map.newRoot);
  }
}

describe("Compile", () => {
  it(`should compile the ZkProgram`, async () => {
    const cache: Cache = Cache.FileSystem("./cache");
    console.log("Analyzing contract methods...");
    console.time("methods analyzed");
    const methods = [
      {
        name: "MapUpdateNew",
        result: await MapUpdateNew.analyzeMethods(),
        skip: true,
      },
      {
        name: "MyContract1",
        result: await MyContract1.analyzeMethods(),
      },
      {
        name: "MyContract4",
        result: await MyContract4.analyzeMethods(),
      },
    ];
    console.timeEnd("methods analyzed");
    const maxRows = 2 ** 16;
    for (const contract of methods) {
      // calculate the size of the contract - the sum or rows for each method
      const size = Object.values(contract.result).reduce(
        (acc, method) => acc + method.rows,
        0
      );
      // calculate percentage rounded to 0 decimal places
      const percentage = Math.round((size / maxRows) * 100);

      console.log(
        `method's total size for a ${contract.name} is ${size} rows (${percentage}% of max ${maxRows} rows)`
      );
      if (contract.skip !== true)
        for (const method in contract.result) {
          console.log(method, `rows:`, (contract.result as any)[method].rows);
        }
    }

    console.log("Compiling MapUpdateNew...");
    console.time("compiled MapUpdateNew");
    await MapUpdateNew.compile({ cache });
    console.timeEnd("compiled MapUpdateNew");

    console.log("Compiling MapUpdate...");
    console.time("compiled MapUpdate");
    //await MapUpdate.compile({ cache });
    console.timeEnd("compiled MapUpdate");

    console.log("Compiling MyContract...");
    console.time("compiled MyContract1");
    await MyContract1.compile({ cache });
    console.timeEnd("compiled MyContract1");
    console.time("compiled MyContract4");
    await MyContract4.compile({ cache });
    console.timeEnd("compiled MyContract4");
  });
});
