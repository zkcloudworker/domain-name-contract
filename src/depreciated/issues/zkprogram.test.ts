import { describe, expect, it } from "@jest/globals";
import { Field, Struct, UInt64, ZkProgram, Provable } from "o1js";

class MapTransition extends Struct({
  value: Field,
}) {
  static create() {
    Provable.log("create");
    return new MapTransition({
      value: Field(100),
    });
  }

  static fromFields1(): MapTransition {
    Provable.log("fromFields");
    return new MapTransition({
      value: Field(30),
    });
  }
}

const MapUpdate = ZkProgram({
  name: "MapUpdate",
  publicInput: MapTransition,

  methods: {
    add: {
      privateInputs: [],

      method(state: MapTransition) {
        Provable.log("MapUpdate.add state.value:", state.value);
      },
    },
  },
});

describe("ZkProgram data corruption", () => {
  it(`should calculate a proof`, async () => {
    await MapUpdate.compile();
    const state: MapTransition = MapTransition.create();
    console.log("State 1:", state.value.toJSON());
    await MapUpdate.add(state);
    console.log("State 2:", state.value.toJSON());
  });
});
