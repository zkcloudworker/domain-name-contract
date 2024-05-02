import { describe, expect, it } from "@jest/globals";
import fs from "fs/promises";
import {
  state,
  State,
  Field,
  PublicKey,
  PrivateKey,
  SmartContract,
  method,
  DeployArgs,
  Permissions,
  Transaction,
  Mina,
  UInt64,
  ZkProgram,
  VerificationKey,
  DynamicProof,
  Empty,
  JsonProof,
  AccountUpdate,
  fetchAccount,
} from "o1js";
import { verificationKey, proof } from "../json/vk.json";
import { initBlockchain, blockchain } from "zkcloudworker";
const chain = "local" as blockchain;

export const MyZkProgram = ZkProgram({
  name: "MyZkProgram",
  publicInput: Field,

  methods: {
    check: {
      privateInputs: [],
      async method(value: Field) {
        value.assertLessThanOrEqual(Field(100));
      },
    },
  },
});

class SideLoadedProgramProof extends DynamicProof<Field, Empty> {
  static publicInputType = Field;
  static publicOutputType = Empty;
  static maxProofsVerified = 0 as const;
}

const vk = {
  hash: Field.fromJSON(verificationKey.hash),
  data: verificationKey.data,
} as VerificationKey;

export const ProxyZkProgram = ZkProgram({
  name: "ProxyZkProgram",
  publicInput: Field,

  methods: {
    check: {
      privateInputs: [SideLoadedProgramProof],
      async method(value: Field, proof: SideLoadedProgramProof) {
        proof.verify(vk);
        value.assertEquals(proof.publicInput);
      },
    },
  },
});
export class ProxyZkProgramProof extends ZkProgram.Proof(ProxyZkProgram) {}

export class MyContract extends SmartContract {
  @state(Field) value = State<Field>();

  @method async setValue(proof: ProxyZkProgramProof) {
    proof.verify();
    this.value.set(proof.publicInput);
  }
}

describe("Side loaded verification keys", () => {
  it(`should create verification key and proof`, async () => {
    const { verificationKey } = await MyZkProgram.compile();
    const proof = await MyZkProgram.check(Field(5));
    await fs.writeFile(
      "./json/vk.json",
      JSON.stringify(
        {
          verificationKey: {
            hash: verificationKey.hash.toJSON(),
            data: verificationKey.data,
          },
          proof: proof.toJSON(),
        },
        null,
        2
      )
    );
  });

  it.skip(`should use vk and proof`, async () => {
    await ProxyZkProgram.compile();
    await MyContract.compile();
    const sideLoadedProof: SideLoadedProgramProof =
      await SideLoadedProgramProof.fromJSON(proof as JsonProof);
    const proxyProof = await ProxyZkProgram.check(
      sideLoadedProof.publicInput,
      sideLoadedProof
    );
    const { keys } = await initBlockchain(chain, 1);
    const sender = keys[0];
    const appKey = PrivateKey.randomKeypair();
    const zkApp = new MyContract(appKey.publicKey);
    await fetchAccount({ publicKey: sender });
    const tx = await Mina.transaction(
      { sender, fee: "100000000", memo: "sideloading deploy" },
      async () => {
        AccountUpdate.fundNewAccount(sender);
        await zkApp.deploy();
      }
    );
    await (await tx.sign([sender.key]).send()).wait();
    await fetchAccount({ publicKey: sender });
    await fetchAccount({ publicKey: appKey.publicKey });
    const tx2 = await Mina.transaction(
      { sender, fee: "100000000", memo: "sideloading send" },
      async () => {
        await zkApp.setValue(proxyProof);
      }
    );
    await (await tx2.sign([sender.key]).send()).wait();
    await fetchAccount({ publicKey: appKey.publicKey });
    const value = zkApp.value.get();
    expect(value.toJSON()).toEqual(Field(5).toJSON());
  });
});
